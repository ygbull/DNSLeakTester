import { describe, it, expect } from 'vitest';
import { evaluateDnsLeak, buildTlsResult, assignDnsVerdict, buildGeoResult } from './runner';
import type { ResolverInfo, GeoResult, TestResult, DnsLeakResult } from './types';
import type { AnalyzeResponse } from '../../worker/types';

function makeGeo(overrides: Partial<GeoResult> = {}): GeoResult {
  return {
    ip: '1.1.1.1', country: 'US', countryCode: 'US', city: null, region: null,
    regionCode: null, postalCode: null, latitude: null, longitude: null, timezone: 'UTC',
    continent: null, isEU: false, asn: 13335, asOrganization: 'CF', colo: 'DFW',
    coloCity: null, coloCountry: null, httpProtocol: 'HTTP/2', isVpnLikely: false,
    ...overrides,
  };
}

describe('evaluateDnsLeak', () => {
  it('returns warn for empty resolvers', () => {
    expect(evaluateDnsLeak([], makeGeo())).toBe('warn');
  });

  it('returns pass for non-VPN with 1-2 resolvers', () => {
    const resolvers: ResolverInfo[] = [{ ip: '8.8.8.8', country: 'US', countryCode: 'US' }];
    expect(evaluateDnsLeak(resolvers, makeGeo())).toBe('pass');
  });

  it('returns warn for non-VPN with >2 resolvers', () => {
    const resolvers: ResolverInfo[] = [
      { ip: '1.1.1.1', country: 'US', countryCode: 'US' },
      { ip: '8.8.8.8', country: 'US', countryCode: 'US' },
      { ip: '9.9.9.9', country: 'DE', countryCode: 'DE' },
    ];
    expect(evaluateDnsLeak(resolvers, makeGeo())).toBe('warn');
  });

  it('filters empty countryCode from resolver set', () => {
    const resolvers: ResolverInfo[] = [
      { ip: '8.8.8.8', country: 'United States', countryCode: 'US' },
      { ip: '1.2.3.4', country: 'Unknown', countryCode: '' },
    ];
    const geo = makeGeo({ isVpnLikely: true, countryCode: 'US' });
    // Should warn: country match alone can't confirm resolver ownership
    expect(evaluateDnsLeak(resolvers, geo)).toBe('warn');
  });

  it('returns warn when resolvers have empty countryCode and VPN country is empty', () => {
    const resolvers: ResolverInfo[] = [{ ip: '8.8.8.8', country: 'Unknown', countryCode: '' }];
    const geo = makeGeo({ isVpnLikely: true, countryCode: '' });
    expect(evaluateDnsLeak(resolvers, geo)).toBe('warn');
  });

  it('returns warn when vpnCountry is null', () => {
    const resolvers: ResolverInfo[] = [{ ip: '8.8.8.8', country: 'US', countryCode: 'US' }];
    const geo = makeGeo({ isVpnLikely: true, countryCode: null });
    expect(evaluateDnsLeak(resolvers, geo)).toBe('warn');
  });

  it('returns fail when resolver country differs from VPN country', () => {
    const resolvers: ResolverInfo[] = [{ ip: '8.8.8.8', country: 'Germany', countryCode: 'DE' }];
    const geo = makeGeo({ isVpnLikely: true, countryCode: 'US' });
    expect(evaluateDnsLeak(resolvers, geo)).toBe('fail');
  });

  it('returns fail for VPN user with mixed-country resolvers including VPN country', () => {
    const resolvers: ResolverInfo[] = [
      { ip: '8.8.8.8', country: 'United States', countryCode: 'US' },
      { ip: '1.2.3.4', country: 'Germany', countryCode: 'DE' },
    ];
    const geo = makeGeo({ isVpnLikely: true, countryCode: 'US' });
    expect(evaluateDnsLeak(resolvers, geo)).toBe('fail');
  });

  it('returns warn for non-VPN when all resolvers have empty countryCode', () => {
    const resolvers: ResolverInfo[] = [
      { ip: '1.2.3.4', country: 'Unknown', countryCode: '' },
      { ip: '5.6.7.8', country: 'Unknown', countryCode: '' },
    ];
    const geo = makeGeo({ isVpnLikely: false, countryCode: 'US' });
    expect(evaluateDnsLeak(resolvers, geo)).toBe('warn');
  });

  it('returns warn when resolvers exist but all lack geo data and user country is null', () => {
    const resolvers: ResolverInfo[] = [
      { ip: '1.2.3.4', country: 'Unknown', countryCode: '' },
    ];
    const geo = makeGeo({ isVpnLikely: false, countryCode: null });
    expect(evaluateDnsLeak(resolvers, geo)).toBe('warn');
  });

  it('returns warn for non-VPN when resolver country differs from user country', () => {
    const resolvers: ResolverInfo[] = [
      { ip: '8.8.8.8', country: 'Germany', countryCode: 'DE' },
    ];
    expect(evaluateDnsLeak(resolvers, makeGeo({ isVpnLikely: false, countryCode: 'US' }))).toBe('warn');
  });

  it('returns pass for non-VPN when resolver matches user country', () => {
    const resolvers: ResolverInfo[] = [
      { ip: '8.8.8.8', country: 'United States', countryCode: 'US' },
    ];
    expect(evaluateDnsLeak(resolvers, makeGeo({ isVpnLikely: false, countryCode: 'US' }))).toBe('pass');
  });

  it('returns warn for non-VPN when user countryCode is null but resolvers have country data', () => {
    const resolvers: ResolverInfo[] = [
      { ip: '8.8.8.8', country: 'Germany', countryCode: 'DE' },
    ];
    expect(evaluateDnsLeak(resolvers, makeGeo({ isVpnLikely: false, countryCode: null }))).toBe('warn');
  });

  it('returns warn for VPN user with single resolver matching VPN country', () => {
    const resolvers: ResolverInfo[] = [{ ip: '8.8.8.8', country: 'United States', countryCode: 'US' }];
    const geo = makeGeo({ isVpnLikely: true, countryCode: 'US' });
    expect(evaluateDnsLeak(resolvers, geo)).toBe('warn');
  });

  it('returns warn for VPN user with two matching resolvers', () => {
    const resolvers: ResolverInfo[] = [
      { ip: '1.1.1.1', country: 'Germany', countryCode: 'DE' },
      { ip: '8.8.8.8', country: 'Germany', countryCode: 'DE' },
    ];
    const geo = makeGeo({ isVpnLikely: true, countryCode: 'DE' });
    expect(evaluateDnsLeak(resolvers, geo)).toBe('warn');
  });

  it('returns warn for non-VPN with country mismatch even with single resolver', () => {
    const resolvers: ResolverInfo[] = [
      { ip: '1.1.1.1', country: 'Japan', countryCode: 'JP' },
    ];
    expect(evaluateDnsLeak(resolvers, makeGeo({ isVpnLikely: false, countryCode: 'US' }))).toBe('warn');
  });
});

describe('buildTlsResult', () => {
  function makeTls(overrides: Partial<AnalyzeResponse['tls']> = {}): AnalyzeResponse['tls'] {
    return {
      version: 'TLSv1.3', cipher: 'AEAD-AES128-GCM-SHA256', protocol: 'HTTP/2',
      ciphersSha1: 'abc', extensionsSha1: 'def', helloLength: '512',
      profileId: 'xyz', knownProfile: null, commonality: 'unknown',
      ...overrides,
    };
  }

  it('returns pass for TLS 1.3 even with null knownProfile', () => {
    const result = buildTlsResult(makeTls({ knownProfile: null }));
    expect(result.verdict).toBe('pass');
  });

  it('returns pass for TLS 1.3 with known profile', () => {
    const result = buildTlsResult(makeTls({ knownProfile: 'Chrome 120+' }));
    expect(result.verdict).toBe('pass');
  });

  it('returns warn for TLS 1.2', () => {
    const result = buildTlsResult(makeTls({ version: 'TLSv1.2' }));
    expect(result.verdict).toBe('warn');
  });
});

describe('assignDnsVerdict', () => {
  function makeDnsResult(resolvers: ResolverInfo[]): TestResult<DnsLeakResult> {
    return {
      id: 'dns', name: 'DNS Leak', status: 'complete', verdict: null,
      data: { resolvers, leakDetected: false, resolverCount: resolvers.length },
      error: null, durationMs: 500,
    };
  }

  it('sets verdict to warn when geo data is null', () => {
    const dns = makeDnsResult([{ ip: '8.8.8.8', country: 'US', countryCode: 'US' }]);
    assignDnsVerdict(dns, null);
    expect(dns.verdict).toBe('warn');
    expect(dns.data!.leakDetected).toBe(false);
  });

  it('evaluates via evaluateDnsLeak when geo data is available', () => {
    const dns = makeDnsResult([{ ip: '8.8.8.8', country: 'US', countryCode: 'US' }]);
    assignDnsVerdict(dns, makeGeo({ isVpnLikely: false }));
    expect(dns.verdict).toBe('pass');
    expect(dns.data!.leakDetected).toBe(false);
  });

  it('sets leakDetected true when verdict is fail', () => {
    const dns = makeDnsResult([{ ip: '8.8.8.8', country: 'Germany', countryCode: 'DE' }]);
    assignDnsVerdict(dns, makeGeo({ isVpnLikely: true, countryCode: 'US' }));
    expect(dns.verdict).toBe('fail');
    expect(dns.data!.leakDetected).toBe(true);
  });

  it('is a no-op when DNS data is null', () => {
    const dns: TestResult<DnsLeakResult> = {
      id: 'dns', name: 'DNS Leak', status: 'error', verdict: null,
      data: null, error: 'DNS test failed', durationMs: 0,
    };
    assignDnsVerdict(dns, makeGeo());
    expect(dns.verdict).toBeNull();
    expect(dns.data).toBeNull();
  });
});

function makeAnalyzeResponse(overrides: {
  network?: Partial<AnalyzeResponse['network']>;
  edge?: Partial<AnalyzeResponse['edge']>;
  geo?: Partial<AnalyzeResponse['geo']>;
} = {}): AnalyzeResponse {
  return {
    ip: '1.1.1.1',
    geo: {
      country: 'United States', countryCode: 'US', city: 'Dallas',
      region: 'Texas', regionCode: 'TX', latitude: '32.7', longitude: '-96.8',
      timezone: 'America/Chicago', continent: 'NA', postalCode: '75001', isEU: false,
      ...overrides.geo,
    },
    network: { asn: 7922, asOrganization: 'Comcast', isVpnLikely: false, ...overrides.network },
    tls: {
      version: 'TLSv1.3', cipher: 'AES128', protocol: 'HTTP/2',
      ciphersSha1: 'a', extensionsSha1: 'b', helloLength: '512',
      profileId: 'x', knownProfile: null, commonality: 'unknown',
    },
    edge: { colo: 'DFW', coloCity: 'Dallas', coloCountry: 'US', httpProtocol: 'HTTP/2', clientTcpRtt: null, ...overrides.edge },
  };
}

describe('buildGeoResult', () => {
  it('returns pass for VPN user', () => {
    const resp = makeAnalyzeResponse({ network: { isVpnLikely: true } });
    expect(buildGeoResult(resp).verdict).toBe('pass');
  });

  it('returns pass for known datacenter ASN', () => {
    const resp = makeAnalyzeResponse({ network: { asn: 16509 } });
    expect(buildGeoResult(resp).verdict).toBe('pass');
  });

  it('returns warn when colo country differs from user country', () => {
    const resp = makeAnalyzeResponse({ edge: { coloCountry: 'DE' } });
    expect(buildGeoResult(resp).verdict).toBe('warn');
  });

  it('returns pass when colo country matches user country (normal ISP)', () => {
    const resp = makeAnalyzeResponse();
    expect(buildGeoResult(resp).verdict).toBe('pass');
  });

  it('returns warn when coloCountry is null (unknown PoP)', () => {
    const resp = makeAnalyzeResponse({ edge: { coloCountry: null } });
    expect(buildGeoResult(resp).verdict).toBe('warn');
  });

  it('returns warn when countryCode is null (unknown user country)', () => {
    const resp = makeAnalyzeResponse({ geo: { countryCode: null } });
    expect(buildGeoResult(resp).verdict).toBe('warn');
  });

  it('returns warn when both coloCountry and countryCode are null', () => {
    const resp = makeAnalyzeResponse({ edge: { coloCountry: null }, geo: { countryCode: null } });
    expect(buildGeoResult(resp).verdict).toBe('warn');
  });

  it('populates GeoResult data fields correctly', () => {
    const resp = makeAnalyzeResponse();
    const result = buildGeoResult(resp);
    expect(result.data?.ip).toBe('1.1.1.1');
    expect(result.data?.isVpnLikely).toBe(false);
    expect(result.data?.colo).toBe('DFW');
    expect(result.id).toBe('geo');
  });
});
