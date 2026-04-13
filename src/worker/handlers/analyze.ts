import type { Env, AnalyzeResponse } from '../types';
import { computeProfileId, lookupProfile, COLO_LOOKUP } from '../services/tls-profiles';
import type { TlsProfile } from '../services/tls-profiles';

// TODO: add more VPN ASN entries as discovered
const KNOWN_VPN_ASNS = new Set<number>([
  39351,  // Mullvad
  212238, // NordVPN
  209103, // ProtonVPN
  13335,  // Cloudflare (WARP)
  9009,   // M247 (used by many VPNs)
  20473,  // Choopa/Vultr (common VPN hosting)
  16276,  // OVH (used by some VPN services)
]);

const KNOWN_DATACENTER_ASNS = new Set<number>([
  // AWS
  16509, 14618,
  // GCP
  15169, 396982,
  // Azure
  8075, 8068,
  // DigitalOcean
  14061,
  // Linode / Akamai
  63949,
  // Vultr
  20473,
  // Hetzner
  24940,
  // OVH
  16276,
]);

const VPN_KEYWORDS: RegExp[] = [
  /\bvpn\b/i, /\bproxy\b/i, /\btunnel\b/i, /\bwarp\b/i,
  /\bmullvad\b/i, /\bnordvpn\b/i, /\bexpressvpn\b/i,
  /\bprotonvpn\b/i, /\bsurfshark\b/i, /\bcyberghost\b/i,
];

// ISO 3166-1 alpha-2 to country name (Cloudflare only provides the code)
const ISO_COUNTRY_NAMES: Record<string, string> = {
  AF: 'Afghanistan', AL: 'Albania', DZ: 'Algeria', AR: 'Argentina',
  AM: 'Armenia', AU: 'Australia', AT: 'Austria', AZ: 'Azerbaijan',
  BH: 'Bahrain', BD: 'Bangladesh', BY: 'Belarus', BE: 'Belgium',
  BO: 'Bolivia', BA: 'Bosnia and Herzegovina', BR: 'Brazil', BG: 'Bulgaria',
  KH: 'Cambodia', CA: 'Canada', CL: 'Chile', CN: 'China',
  CO: 'Colombia', CR: 'Costa Rica', HR: 'Croatia', CY: 'Cyprus',
  CZ: 'Czech Republic', DK: 'Denmark', DO: 'Dominican Republic', EC: 'Ecuador',
  EG: 'Egypt', SV: 'El Salvador', EE: 'Estonia', ET: 'Ethiopia',
  FI: 'Finland', FR: 'France', GE: 'Georgia', DE: 'Germany',
  GH: 'Ghana', GR: 'Greece', GT: 'Guatemala', HK: 'Hong Kong',
  HU: 'Hungary', IS: 'Iceland', IN: 'India', ID: 'Indonesia',
  IR: 'Iran', IQ: 'Iraq', IE: 'Ireland', IL: 'Israel',
  IT: 'Italy', JM: 'Jamaica', JP: 'Japan', JO: 'Jordan',
  KZ: 'Kazakhstan', KE: 'Kenya', KR: 'South Korea', KW: 'Kuwait',
  LV: 'Latvia', LB: 'Lebanon', LT: 'Lithuania', LU: 'Luxembourg',
  MY: 'Malaysia', MX: 'Mexico', MD: 'Moldova', MN: 'Mongolia',
  MA: 'Morocco', MM: 'Myanmar', NP: 'Nepal', NL: 'Netherlands',
  NZ: 'New Zealand', NG: 'Nigeria', NO: 'Norway', OM: 'Oman',
  PK: 'Pakistan', PA: 'Panama', PY: 'Paraguay', PE: 'Peru',
  PH: 'Philippines', PL: 'Poland', PT: 'Portugal', QA: 'Qatar',
  RO: 'Romania', RU: 'Russia', SA: 'Saudi Arabia', RS: 'Serbia',
  SG: 'Singapore', SK: 'Slovakia', SI: 'Slovenia', ZA: 'South Africa',
  ES: 'Spain', LK: 'Sri Lanka', SE: 'Sweden', CH: 'Switzerland',
  TW: 'Taiwan', TH: 'Thailand', TR: 'Turkey', UA: 'Ukraine',
  AE: 'United Arab Emirates', GB: 'United Kingdom', US: 'United States',
  UY: 'Uruguay', UZ: 'Uzbekistan', VE: 'Venezuela', VN: 'Vietnam',
};

function detectVpn(asn: number, asOrganization: string): boolean {
  if (KNOWN_VPN_ASNS.has(asn)) return true;
  if (KNOWN_DATACENTER_ASNS.has(asn)) return true;
  return VPN_KEYWORDS.some(re => re.test(asOrganization));
}

export async function handleAnalyze(request: Request, _env: Env): Promise<Response> {
  const cf = request.cf;
  const ip = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';

  const asn = Number(cf?.asn) || 0;
  const asOrg = String(cf?.asOrganization ?? 'Unknown');
  const colo = String(cf?.colo ?? 'Unknown');
  const coloInfo = COLO_LOOKUP[colo] ?? null;

  const tlsProfile: TlsProfile = {
    version: String(cf?.tlsVersion ?? 'unknown'),
    cipher: String(cf?.tlsCipher ?? 'unknown'),
    protocol: String(cf?.httpProtocol ?? 'unknown'),
    ciphersSha1: String((cf as Record<string, unknown>)?.tlsClientCiphersSha1 ?? ''),
    extensionsSha1: String((cf as Record<string, unknown>)?.tlsClientExtensionsSha1 ?? ''),
    helloLength: String((cf as Record<string, unknown>)?.tlsClientHelloLength ?? ''),
  };

  const profileId = computeProfileId(tlsProfile);
  const knownProfile = lookupProfile(profileId);

  const body: AnalyzeResponse = {
    ip,
    geo: {
      country: cf?.country
        ? (ISO_COUNTRY_NAMES[cf.country as string] ?? cf.country as string)
        : null,
      countryCode: cf?.country as string ?? null,
      city: cf?.city as string ?? null,
      region: cf?.region as string ?? null,
      regionCode: cf?.regionCode as string ?? null,
      latitude: cf?.latitude as string ?? null,
      longitude: cf?.longitude as string ?? null,
      timezone: String(cf?.timezone ?? 'UTC'),
      continent: cf?.continent as string ?? null,
      postalCode: cf?.postalCode as string ?? null,
      isEU: cf?.isEUCountry === '1',
    },
    network: {
      asn,
      asOrganization: asOrg,
      isVpnLikely: detectVpn(asn, asOrg),
    },
    tls: {
      version: tlsProfile.version,
      cipher: tlsProfile.cipher,
      protocol: tlsProfile.protocol,
      ciphersSha1: tlsProfile.ciphersSha1,
      extensionsSha1: tlsProfile.extensionsSha1,
      helloLength: tlsProfile.helloLength,
      profileId,
      knownProfile,
      commonality: knownProfile ? 'known' : 'unknown',
    },
    edge: {
      colo,
      coloCity: coloInfo?.city ?? null,
      coloCountry: coloInfo?.country ?? null,
      httpProtocol: String(cf?.httpProtocol ?? 'unknown'),
      clientTcpRtt: cf?.clientTcpRtt != null ? Number(cf.clientTcpRtt) : null,
    },
  };

  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
