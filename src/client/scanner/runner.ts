import type { AnalyzeResponse } from '../../worker/types';
import type {
  ScanProgress, ScanResults, TestResult, TestVerdict,
  TlsResult, GeoResult, DnsLeakResult, ResolverInfo,
} from './types';
import { runWebRtcTest } from './webrtc';
import { runFingerprintTest } from './fingerprint';
import { initDnsTest, triggerDnsProbes, pollDnsResults } from './dns';
import { abortableSleep } from '../utils/format';
import { computeGrade } from '../ui/grade';

const API_BASE = '';

// Known datacenter ASNs — duplicated here to avoid importing worker code
const KNOWN_DATACENTER_ASNS = new Set([
  16509, 14618, 15169, 396982, 8075, 8068,
  14061, 63949, 20473, 24940, 16276,
]);

async function fetchAnalyzeData(base: string, signal?: AbortSignal): Promise<AnalyzeResponse> {
  const response = await fetch(`${base}/api/analyze`, { signal });
  if (!response.ok) throw new Error(`Analyze failed: ${response.status}`);
  return response.json();
}

function wrapResult<T>(id: string, name: string, raw: T, verdict: TestVerdict, durationMs: number): TestResult<T> {
  return { id, name, status: 'complete', verdict, data: raw, error: null, durationMs };
}

function errorResult<T>(id: string, name: string, error: unknown): TestResult<T> {
  return {
    id, name, status: 'error', verdict: null, data: null,
    error: error instanceof Error ? error.message : 'Unknown error', durationMs: 0,
  };
}

// Exported for testing
export function buildTlsResult(tls: AnalyzeResponse['tls']): TestResult<TlsResult> {
  const data: TlsResult = { ...tls };
  // TLS 1.3 is a strong baseline regardless of profile recognition
  // TODO: once KNOWN_PROFILES is populated, use profile match for richer detail reporting
  const verdict: TestVerdict = tls.version !== 'TLSv1.3' ? 'warn' : 'pass';
  return wrapResult('tls', 'TLS Analysis', data, verdict, 0);
}

export function buildGeoResult(resp: AnalyzeResponse): TestResult<GeoResult> {
  const data: GeoResult = {
    ip: resp.ip,
    country: resp.geo.country ?? null,
    countryCode: resp.geo.countryCode ?? null,
    city: resp.geo.city ?? null,
    region: resp.geo.region ?? null,
    regionCode: resp.geo.regionCode ?? null,
    postalCode: resp.geo.postalCode ?? null,
    latitude: resp.geo.latitude ?? null,
    longitude: resp.geo.longitude ?? null,
    timezone: resp.geo.timezone,
    continent: resp.geo.continent ?? null,
    isEU: resp.geo.isEU,
    asn: resp.network.asn,
    asOrganization: resp.network.asOrganization,
    colo: resp.edge.colo,
    coloCity: resp.edge.coloCity,
    coloCountry: resp.edge.coloCountry,
    httpProtocol: resp.edge.httpProtocol,
    isVpnLikely: resp.network.isVpnLikely,
  };

  let verdict: TestVerdict;
  if (data.isVpnLikely) {
    verdict = 'pass';
  } else if (KNOWN_DATACENTER_ASNS.has(data.asn)) {
    verdict = 'pass';
  } else if (data.coloCountry && data.countryCode && data.coloCountry !== data.countryCode) {
    verdict = 'warn';
  } else if (data.coloCountry && data.countryCode) {
    // Countries match — normal network path, no anomaly
    verdict = 'pass';
  } else {
    // Missing geo data — can't determine
    verdict = 'warn';
  }
  return wrapResult('geo', 'IP & Geo', data, verdict, 0);
}

export function evaluateDnsLeak(resolvers: ResolverInfo[], userGeo: GeoResult): TestVerdict {
  if (resolvers.length === 0) return 'warn';

  const resolverCountries = new Set(
    resolvers.map(r => r.countryCode).filter(c => c !== '')
  );

  if (userGeo.isVpnLikely) {
    const vpnCountry = userGeo.countryCode;
    if (!vpnCountry) return 'warn'; // can't evaluate without VPN country
    const resolverMatchesVpn = resolverCountries.has(vpnCountry);
    const hasLeakedResolver = [...resolverCountries].some(c => c !== vpnCountry);

    if (hasLeakedResolver) return 'fail';
    if (!resolverMatchesVpn) return 'warn';
    if (resolvers.length > 2) return 'warn';
    // Can't confirm resolvers belong to VPN provider via country match alone
    return 'warn';
  }

  // Non-VPN: if resolvers exist but none have geo data, can't evaluate
  if (resolvers.length > 0 && resolverCountries.size === 0) return 'warn';

  // Non-VPN: flag country mismatch if detectable
  if (userGeo.countryCode && resolverCountries.size > 0) {
    if (!resolverCountries.has(userGeo.countryCode)) return 'warn';
  } else if (!userGeo.countryCode && resolverCountries.size > 0) {
    return 'warn'; // can't verify without user country
  }

  if (resolvers.length > 2) return 'warn';
  return 'pass';
}

export function assignDnsVerdict(
  dnsResult: TestResult<DnsLeakResult>,
  geoData: GeoResult | null
): void {
  if (!dnsResult.data) return;

  if (geoData) {
    const verdict = evaluateDnsLeak(dnsResult.data.resolvers, geoData);
    dnsResult.verdict = verdict;
    dnsResult.data.leakDetected = verdict === 'fail';
  } else {
    // Can't fully evaluate without geo context — warn rather than guess
    dnsResult.verdict = 'warn';
    dnsResult.data.leakDetected = false;
  }
}

export async function* runAllTests(signal?: AbortSignal): AsyncGenerator<ScanProgress> {
  const sessionId = crypto.randomUUID();
  const results: Partial<ScanResults> = { sessionId, timestamp: Date.now() };

  yield { phase: 'Initializing...', testsComplete: 0, testsTotal: 5, currentTest: null, results };

  // Fire DNS init early (non-blocking)
  const dnsInitPromise = initDnsTest(API_BASE, signal).catch((e: unknown) => e as Error);

  // 1. Network analysis
  yield { phase: 'Analyzing network...', testsComplete: 0, testsTotal: 5, currentTest: 'Network Analysis', results };
  try {
    const data = await fetchAnalyzeData(API_BASE, signal);
    results.tls = buildTlsResult(data.tls);
    results.geo = buildGeoResult(data);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    results.tls = errorResult('tls', 'TLS Analysis', e);
    results.geo = errorResult('geo', 'IP & Geo', e);
  }
  yield { phase: 'Network analyzed', testsComplete: 1, testsTotal: 5, currentTest: 'WebRTC', results };

  // 2. WebRTC
  signal?.throwIfAborted();
  try {
    const raw = await runWebRtcTest(signal);
    let verdict: TestVerdict = 'pass';
    if (raw.leakDetected) {
      verdict = 'fail';
    } else if (raw.publicIp && results.geo?.data?.ip && raw.publicIp !== results.geo.data.ip) {
      verdict = 'warn';
    }
    results.webrtc = wrapResult('webrtc', 'WebRTC Leak', raw, verdict, 0);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    results.webrtc = errorResult('webrtc', 'WebRTC Leak', e);
  }
  yield { phase: 'WebRTC complete', testsComplete: 2, testsTotal: 5, currentTest: 'Fingerprint', results };

  // 3. Fingerprint
  signal?.throwIfAborted();
  try {
    const raw = await runFingerprintTest();
    const verdict: TestVerdict = raw.entropy > 33 ? 'fail' : raw.entropy > 20 ? 'warn' : 'pass';
    results.fingerprint = wrapResult('fingerprint', 'Browser Fingerprint', raw, verdict, 0);
  } catch (e) {
    results.fingerprint = errorResult('fingerprint', 'Browser Fingerprint', e);
  }
  yield { phase: 'Fingerprint complete', testsComplete: 3, testsTotal: 5, currentTest: 'DNS Leak', results };

  // 4. DNS probes + poll
  signal?.throwIfAborted();
  const dnsInit = await dnsInitPromise;
  if (!(dnsInit instanceof Error)) {
    try {
      await triggerDnsProbes(dnsInit.probeHostnames, dnsInit.delayBetweenProbesMs, signal);
      await abortableSleep(dnsInit.waitAfterProbesMs, signal);
      const dnsResult = await pollDnsResults(API_BASE, dnsInit.testId, 3, signal);

      assignDnsVerdict(dnsResult, results.geo?.data ?? null);
      results.dns = dnsResult;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      results.dns = errorResult('dns', 'DNS Leak', e);
    }
  } else {
    results.dns = errorResult('dns', 'DNS Leak', dnsInit);
  }

  yield { phase: 'DNS complete', testsComplete: 4, testsTotal: 5, currentTest: 'Computing Results', results };

  // 5. Compute grade
  results.overallGrade = computeGrade(results as ScanResults);
  yield { phase: 'Scan complete', testsComplete: 5, testsTotal: 5, currentTest: null, results };
}
