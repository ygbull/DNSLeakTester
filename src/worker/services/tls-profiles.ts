import { simpleHash } from '../../shared/hash';

export interface TlsProfile {
  version: string;
  cipher: string;
  protocol: string;
  ciphersSha1: string;
  extensionsSha1: string;
  helloLength: string;
}

export function computeProfileId(profile: TlsProfile): string {
  const raw = `${profile.version}|${profile.ciphersSha1}|${profile.extensionsSha1}|${profile.helloLength}`;
  return simpleHash(raw);
}

// Populated during production testing by visiting /api/analyze from each browser.
// Empty is expected for fresh deployments — client treats null knownProfile as pass
// for TLS 1.3 (the profile database enhances detail reporting, not grading).
// TODO: add profiles from Chrome, Firefox, Safari, Edge after first deploy
const KNOWN_PROFILES: Record<string, string> = {};

export function lookupProfile(profileId: string): string | null {
  return KNOWN_PROFILES[profileId] ?? null;
}

// Top ~50 Cloudflare edge PoP codes → city/country
export const COLO_LOOKUP: Record<string, { city: string; country: string }> = {
  DFW: { city: 'Dallas', country: 'US' },
  IAH: { city: 'Houston', country: 'US' },
  SJC: { city: 'San Jose', country: 'US' },
  LAX: { city: 'Los Angeles', country: 'US' },
  EWR: { city: 'Newark', country: 'US' },
  ORD: { city: 'Chicago', country: 'US' },
  ATL: { city: 'Atlanta', country: 'US' },
  SEA: { city: 'Seattle', country: 'US' },
  MIA: { city: 'Miami', country: 'US' },
  IAD: { city: 'Ashburn', country: 'US' },
  AMS: { city: 'Amsterdam', country: 'NL' },
  LHR: { city: 'London', country: 'GB' },
  FRA: { city: 'Frankfurt', country: 'DE' },
  CDG: { city: 'Paris', country: 'FR' },
  NRT: { city: 'Tokyo', country: 'JP' },
  SIN: { city: 'Singapore', country: 'SG' },
  SYD: { city: 'Sydney', country: 'AU' },
  YYZ: { city: 'Toronto', country: 'CA' },
  GRU: { city: 'São Paulo', country: 'BR' },
  BOM: { city: 'Mumbai', country: 'IN' },
  HKG: { city: 'Hong Kong', country: 'HK' },
  ICN: { city: 'Seoul', country: 'KR' },
  AUS: { city: 'Austin', country: 'US' },
  DEN: { city: 'Denver', country: 'US' },
  PHX: { city: 'Phoenix', country: 'US' },
  MSP: { city: 'Minneapolis', country: 'US' },
  BOS: { city: 'Boston', country: 'US' },
  JFK: { city: 'New York', country: 'US' },
  SFO: { city: 'San Francisco', country: 'US' },
  PDX: { city: 'Portland', country: 'US' },
  YVR: { city: 'Vancouver', country: 'CA' },
  MEX: { city: 'Mexico City', country: 'MX' },
  SCL: { city: 'Santiago', country: 'CL' },
  BOG: { city: 'Bogotá', country: 'CO' },
  EZE: { city: 'Buenos Aires', country: 'AR' },
  MAD: { city: 'Madrid', country: 'ES' },
  MXP: { city: 'Milan', country: 'IT' },
  ARN: { city: 'Stockholm', country: 'SE' },
  WAW: { city: 'Warsaw', country: 'PL' },
  HEL: { city: 'Helsinki', country: 'FI' },
  OSL: { city: 'Oslo', country: 'NO' },
  CPH: { city: 'Copenhagen', country: 'DK' },
  ZRH: { city: 'Zurich', country: 'CH' },
  VIE: { city: 'Vienna', country: 'AT' },
  PRG: { city: 'Prague', country: 'CZ' },
  BRU: { city: 'Brussels', country: 'BE' },
  DUB: { city: 'Dublin', country: 'IE' },
  MAN: { city: 'Manchester', country: 'GB' },
  KIX: { city: 'Osaka', country: 'JP' },
  DEL: { city: 'New Delhi', country: 'IN' },
  JNB: { city: 'Johannesburg', country: 'ZA' },
};
