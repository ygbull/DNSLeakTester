export interface Env {
  LEAK_STORE: KVNamespace;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  CORS_ORIGIN: string;
}

export interface AnalyzeResponse {
  ip: string;
  geo: {
    country: string | null;
    countryCode: string | null;
    city: string | null;
    region: string | null;
    regionCode: string | null;
    latitude: string | null;
    longitude: string | null;
    timezone: string;
    continent: string | null;
    postalCode: string | null;
    isEU: boolean;
  };
  network: {
    asn: number;
    asOrganization: string;
    isVpnLikely: boolean;
  };
  tls: {
    version: string;
    cipher: string;
    protocol: string;
    ciphersSha1: string;
    extensionsSha1: string;
    helloLength: string;
    profileId: string;
    knownProfile: string | null;
    commonality: 'known' | 'unknown';
  };
  edge: {
    colo: string;
    coloCity: string | null;
    coloCountry: string | null;
    httpProtocol: string;
    clientTcpRtt: number | null;
  };
}

export interface DnsStartResponse {
  testId: string;
  probeCount: number;
  probeHostnames: string[];
  delayBetweenProbesMs: number;
  waitAfterProbesMs: number;
}

export interface DnsCheckResponse {
  status: 'pending' | 'complete' | 'error';
  resolvers: ResolverInfo[];
  message: string | null;
}

export interface ResolverInfo {
  ip: string;
  country: string;
  countryCode: string;
}

export interface DnsProbeSession {
  bashWsId: string;
  status: 'probing' | 'complete' | 'error';
  startedAt: number;
}
