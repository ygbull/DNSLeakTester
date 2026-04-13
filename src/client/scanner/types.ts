export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type TestStatus = 'pending' | 'running' | 'complete' | 'error' | 'skipped';
export type TestVerdict = 'pass' | 'warn' | 'fail';

export interface TestResult<T = unknown> {
  id: string;
  name: string;
  status: TestStatus;
  verdict: TestVerdict | null;
  data: T | null;
  error: string | null;
  durationMs: number;
}

export interface DnsLeakResult {
  resolvers: ResolverInfo[];
  leakDetected: boolean;
  resolverCount: number;
}

export interface ResolverInfo {
  ip: string;
  country: string;
  countryCode: string;
}

export interface WebRtcResult {
  webrtcSupported: boolean;
  localIps: string[];
  publicIp: string | null;
  mdnsAddresses: string[];
  leakDetected: boolean;
}

export interface TlsResult {
  version: string;
  cipher: string;
  protocol: string;
  ciphersSha1: string;
  extensionsSha1: string;
  helloLength: string;
  profileId: string;
  knownProfile: string | null;
  commonality: 'known' | 'unknown';
}

export interface FingerprintResult {
  entropy: number;
  components: FingerprintComponent[];
  uniqueAmong: number;
}

export interface FingerprintComponent {
  name: string;
  value: string;
  entropy: number;
}

export interface GeoResult {
  ip: string;
  country: string | null;
  countryCode: string | null;
  city: string | null;
  region: string | null;
  regionCode: string | null;
  postalCode: string | null;
  latitude: string | null;
  longitude: string | null;
  timezone: string;
  continent: string | null;
  isEU: boolean;
  asn: number;
  asOrganization: string;
  colo: string;
  coloCity: string | null;
  coloCountry: string | null;
  httpProtocol: string;
  isVpnLikely: boolean;
}

export interface ScanProgress {
  phase: string;
  testsComplete: number;
  testsTotal: number;
  currentTest: string | null;
  results: Partial<ScanResults>;
}

export interface ScanResults {
  sessionId: string;
  timestamp: number;
  dns: TestResult<DnsLeakResult>;
  webrtc: TestResult<WebRtcResult>;
  tls: TestResult<TlsResult>;
  fingerprint: TestResult<FingerprintResult>;
  geo: TestResult<GeoResult>;
  overallGrade: Grade;
}
