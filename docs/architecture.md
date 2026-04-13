# Architecture — DNS Leak Tester

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Browser                             │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ Test Runner   │  │ WebRTC Test  │  │ Fingerprint   │ │
│  │ (orchestrator)│  │ (ICE/STUN)   │  │ (canvas, etc) │ │
│  └──────┬───────┘  └──────────────┘  └───────────────┘ │
│         │                                                │
│         ▼                                                │
│  ┌──────────────────────────────────┐                   │
│  │ API Client (fetch to Worker)     │                   │
│  └──────────────┬───────────────────┘                   │
└─────────────────┼───────────────────────────────────────┘
                  │ HTTPS
                  ▼
┌─────────────────────────────────────────────────────────┐
│              Cloudflare Edge (free tier)                  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Worker: leak-tester                               │   │
│  │                                                    │   │
│  │  Routes:                                           │   │
│  │  - <your-domain>/*                → main handler  │   │
│  │                                                    │   │
│  │  Endpoints:                                        │   │
│  │  GET  /                    → serve frontend        │   │
│  │  GET  /api/analyze         → IP/geo/TLS/edge data  │   │
│  │  POST /api/dns/start       → init DNS leak test    │   │
│  │  GET  /api/dns/check/:id   → poll DNS test results │   │
│  └──────────────┬───────────────────────────────────┘   │
│                 │                                        │
│  ┌──────────────┴────────┐   ┌────────────────────┐    │
│  │ KV: LEAK_STORE        │   │ Cloudflare DNS     │    │
│  │ (60s TTL, ephemeral)  │   │ (authoritative NS) │    │
│  └───────────────────────┘   └────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                  │
                  │ Proxy (for DNS leak test)
                  ▼
┌─────────────────────────────────────────────────────────┐
│  Third-party DNS Leak API (bash.ws)                      │
│  - GET  /id              → returns unique test ID        │
│  - DNS  {n}.{id}.bash.ws → triggers DNS resolution       │
│  - GET  /dnsleak/test/{id}?json → returns resolver IPs   │
└─────────────────────────────────────────────────────────┘
```

---

## Infrastructure Setup

### Cloudflare DNS Records

| Type | Name | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| CNAME | `leak` | `<your-worker>.workers.dev` | Proxied | Auto |

The wildcard `*.probe.leak` DNS record is not needed when using bash.ws as the DNS backend. See "Future: Self-Hosted DNS" for when self-hosting replaces the third-party backend.

### Cloudflare Worker Routes

| Pattern | Worker |
|---------|--------|
| `<your-domain>/*` | `leak-tester` |

### wrangler.toml

See `wrangler.toml.example` in the repo root. Copy it to `wrangler.toml` and fill in your KV namespace IDs and domain before deploying. The key settings:

- `run_worker_first = true` routes all requests through the Worker (for security headers on static assets)
- `LEAK_STORE` KV namespace stores ephemeral DNS test sessions (60s TTL)
- `CORS_ORIGIN` must be set to your production domain

### KV Namespace: `LEAK_STORE`

| Key Pattern | Value | TTL | Purpose |
|---|---|---|---|
| `dns:{testId}` | `DnsProbeSession` JSON | 60s | DNS test session state |

**Free tier budget:** 1,000 KV writes/day. Each scan uses 1 KV write (session init). Supports ~1,000 scans/day.

---

## Test 1: DNS Leak Detection

### How DNS Leak Testing Works (The Real Technique)

DNS leak testing exploits a fundamental property of DNS: when a browser resolves a never-before-seen domain, the query must traverse the full DNS hierarchy until it reaches the **authoritative nameserver** for that domain. That authoritative nameserver can see the **IP address of the DNS resolver** that queried it.

**Step-by-step flow (how dnsleaktest.com works):**

1. The test server generates a unique session ID (e.g., `a7b3c9d2`)
2. The browser is instructed to resolve random subdomains: `1.a7b3c9d2.test.dnsleaktest.com`, `2.a7b3c9d2.test.dnsleaktest.com`, etc.
3. Because these subdomains have never existed before, they cannot be cached anywhere in the DNS hierarchy. Every query must reach the authoritative nameserver.
4. The test operator's authoritative nameserver receives these queries and logs the **source IP of each incoming DNS query** — this is the user's DNS resolver's IP.
5. The web page fetches results from an HTTP API. The server correlates the session ID from the subdomain with the logged resolver IPs.
6. If multiple resolvers appear, or if the resolver doesn't match the expected VPN provider, DNS is leaking.

**The critical requirement:** The test operator must run their own authoritative DNS server for the probe domain. The DNS query and the HTTP request are completely separate network flows — you cannot determine DNS resolver information from the HTTP layer.

### Why Cloudflare-Only Doesn't Work

When Cloudflare is the authoritative nameserver for `haijieqin.com`:

1. DNS query for `random.probe.leak.haijieqin.com` → Cloudflare's authoritative DNS handles it
2. Cloudflare returns an edge IP → browser connects to that IP
3. HTTP request arrives at the Worker

At step 3, the Worker sees:
- `CF-Connecting-IP`: the user's IP (NOT the resolver's IP)
- `request.cf.*`: geo, ASN, TLS metadata of the user's connection

The Worker has **zero visibility** into which DNS resolver resolved the domain at step 1. That information exists only within Cloudflare's DNS infrastructure, and is not exposed to Workers.

**Cloudflare DNS Analytics** (free tier) does log resolver source IPs, but:
- Data appears with 5-15+ minute latency (not suitable for real-time testing)
- Uses sampling at the aggregation layer — a single DNS query for a random subdomain may not appear
- The GraphQL API is designed for analytics, not per-query lookups

### Implemented Approach: Third-Party DNS Leak API

We use the [bash.ws](https://bash.ws) DNS leak testing service, proxied through our Cloudflare Worker:

**Flow:**

```
1. Client → Worker POST /api/dns/start
   Worker → bash.ws GET https://bash.ws/id
   Worker ← bash.ws "a7b3c9d2"
   Worker validates ID matches /^[a-zA-Z0-9]+$/ (rejects path traversal, newlines, etc.)
   Worker stores session in KV: dns:{testId} → { bashWsId: "a7b3c9d2", status: "probing", startedAt: ... }
   Client ← Worker { testId: "uuid", probeCount: 10, probeHostnames: ["1.a7b3c9d2.bash.ws", ...] }

2. Client triggers DNS resolution by loading 10 probe images:
   <img src="https://1.a7b3c9d2.bash.ws" ...>
   <img src="https://2.a7b3c9d2.bash.ws" ...>
   ... (10 probes, sequential with 200ms delay between each)
   NOTE: These are DIRECT browser→bash.ws HTTPS requests.
   bash.ws sees the user's IP and User-Agent (referrer blocked by Referrer-Policy: no-referrer).
   This is a significant privacy trade-off of using a third-party backend.

3. Client waits 3 seconds for DNS queries to propagate

4. Client → Worker GET /api/dns/check/{testId}
   Worker → bash.ws GET https://bash.ws/dnsleak/test/a7b3c9d2?json
   Worker ← bash.ws [{ "ip": "8.8.8.8", "country_name": "United States", ... }]
   Worker fetches results from bash.ws and returns them (no additional KV write)
   Client ← Worker { resolvers: [...], leakDetected: true/false, verdict: "pass"/"warn"/"fail" }
```

**Why proxy through the Worker?**
- bash.ws may not have CORS headers for direct browser access
- The Worker can enrich results with analysis (compare resolver IPs to known VPN providers)
- Abstraction allows swapping backends later

**Timeout handling:** If bash.ws doesn't return results after 3 polls (each 2 seconds apart), report `status: "error"` with message "DNS leak test timed out. Results may take longer than expected."

### DNS Leak Test Backend Interface

```typescript
// src/worker/services/dns-backend.ts

interface DnsTestBackend {
  /** Start a new DNS leak test, return probe configuration */
  startTest(): Promise<DnsTestInit>;
  /** Fetch results for a previously started test */
  getResults(testId: string): Promise<DnsLeakApiResult>;
}

// Internal backend response — backendTestId is the third-party's ID (e.g., bash.ws ID).
// The Worker wraps this into a DnsStartResponse for the client, mapping
// backendTestId to its own testId (UUID).
interface DnsTestInit {
  backendTestId: string;         // The third-party service's test ID
  probeHostnames: string[];      // Hostnames the browser should resolve
  probeCount: number;
  delayBetweenProbesMs: number;  // 200
  waitAfterProbesMs: number;     // 3000
}

interface DnsLeakApiResult {
  resolvers: ResolverInfo[];
  ready: boolean;                // false if results not yet available
}

// Implementation: BashWsBackend
// - startTest() → fetches https://bash.ws/id
// - getResults(id) → fetches https://bash.ws/dnsleak/test/{id}?json
// - HTTP errors from bash.ws propagate as exceptions (not { ready: false }),
//   so the proxy returns 502 immediately instead of the client polling a broken endpoint

// Future implementation: SelfHostedBackend
// - Requires VPS with custom DNS server + NS delegation
// - See "Future: Self-Hosted DNS" section below
```

### DNS Leak Verdict Logic

```typescript
// NOTE: This runs CLIENT-SIDE in the runner, not in the Worker.
// It needs both resolver data (from /api/dns/check) and geo data (from /api/analyze).
function evaluateDnsLeak(resolvers: ResolverInfo[], userGeo: GeoResult): TestVerdict {
  if (resolvers.length === 0) return 'warn'; // inconclusive

  const resolverCountries = new Set(
    resolvers.map(r => r.countryCode).filter(c => c !== '')
  );

  // Context-aware: VPN users get checked for resolver country mismatch
  if (userGeo.isVpnLikely) {
    const vpnCountry = userGeo.countryCode;
    if (!vpnCountry) return 'warn'; // can't evaluate without VPN country
    const resolverMatchesVpn = resolverCountries.has(vpnCountry);
    const hasLeakedResolver = [...resolverCountries].some(c => c !== vpnCountry);

    if (hasLeakedResolver) return 'fail'; // DNS leaking to different country
    if (!resolverMatchesVpn) return 'warn'; // can't determine — no country data
    if (resolvers.length > 2) return 'warn'; // multiple resolvers — possible split
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

  if (resolvers.length > 2) return 'warn'; // unusual number of resolvers
  return 'pass'; // normal ISP DNS
}
```

### Future: Self-Hosted DNS Server

For production or maximum credibility, replace bash.ws with a self-hosted authoritative DNS server:

1. **VPS** (~$3-5/month): Hetzner, Vultr, or DigitalOcean
2. **DNS server**: Node.js `dns2` package or Python `dnslib` (~50 lines of code)
3. **NS delegation**: In Cloudflare DNS, add NS records:
   ```
   probe.leak  NS  ns1.yourvps.example.com
   probe.leak  NS  ns2.yourvps.example.com
   ```
4. **Custom DNS server** listens on port 53 (UDP/TCP):
   - Receives queries for `{n}.{sessionId}.probe.leak.haijieqin.com`
   - Extracts session ID from subdomain
   - Logs the source IP (this IS the resolver IP)
   - Returns a valid A record (e.g., the VPS IP or a Cloudflare IP)
   - Stores `{sessionId} → [resolverIp1, resolverIp2, ...]` in Redis/SQLite
5. **HTTP API** on the VPS: Worker fetches results from `https://ns1.yourvps.example.com/api/results/{sessionId}`

This architecture is documented for the README "Technical Deep Dive" section.

---

## Test 2: WebRTC Local IP Leak Detection

### How It Works

WebRTC's ICE (Interactive Connectivity Establishment) candidate gathering exposes network interface information. When a `RTCPeerConnection` is created and an offer is generated, the browser gathers ICE candidates containing IP addresses:

- **Host candidates**: Local/private IPs (e.g., `192.168.1.105`)
- **Server-reflexive (srflx) candidates**: Public IP discovered via STUN
- **mDNS candidates**: Obfuscated `.local` addresses (privacy protection)

### Browser Behavior (2025-2026)

| Browser | Local IP Leak? | Details |
|---------|---------------|---------|
| Chrome 74+ | Obfuscated | mDNS replaces local IPs with `{uuid}.local` |
| Firefox 68+ | Obfuscated | mDNS support, can fully disable WebRTC via `about:config` |
| Safari 17+ | Obfuscated | mDNS, more restrictive by default |
| Brave | Blocked | Built-in fingerprinting protection blocks WebRTC IP leaks |
| Edge | Obfuscated | Follows Chromium/Chrome behavior |
| Older browsers | **Exposed** | Pre-mDNS browsers leak local IPs |

**Exception:** If `getUserMedia()` permission is granted (camera/microphone), Chrome may expose real local IPs instead of mDNS addresses. Our test does NOT request `getUserMedia()`.

### Implementation

```typescript
// src/client/scanner/webrtc.ts

// Returns raw WebRtcResult — the runner in scanner/runner.ts wraps this in TestResult<WebRtcResult>
async function runWebRtcTest(): Promise<WebRtcResult> {
  if (typeof RTCPeerConnection === 'undefined') {
    return { webrtcSupported: false, localIps: [], publicIp: null, mdnsAddresses: [], leakDetected: false };
  }

  const ips: Set<string> = new Set();
  const mdns: Set<string> = new Set();

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  return new Promise((resolve) => {
    const timeout = setTimeout(() => finish(), 5000);

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        finish();
        return;
      }

      const candidate = event.candidate.candidate;
      if (!candidate) return;

      // Parse candidate string: "candidate:... <ip> <port> typ <type>"
      const parts = candidate.split(' ');
      const ip = parts[4];
      const type = parts[7]; // "host", "srflx", "relay"

      if (!ip) return;

      if (ip.endsWith('.local')) {
        mdns.add(ip);
      } else if (isPrivateIp(ip)) {
        ips.add(ip);
      } else if (type === 'srflx' || type === 'prflx') {
        // Public IP via STUN — record but don't flag as local leak
        ips.add(`public:${ip}`);
      } else {
        // host candidate with public IP — directly-assigned, counts as local leak
        ips.add(ip);
      }
    };

    pc.createDataChannel('');
    pc.createOffer().then(offer => pc.setLocalDescription(offer));

    function finish() {
      clearTimeout(timeout);
      pc.close();

      const localIps = [...ips].filter(ip => !ip.startsWith('public:'));
      const publicIp = [...ips].find(ip => ip.startsWith('public:'))?.replace('public:', '') ?? null;

      resolve({
        webrtcSupported: true,
        localIps,
        publicIp,
        mdnsAddresses: [...mdns],
        leakDetected: localIps.length > 0,
      });
    }
  });
}
```

### Private IP Detection

```typescript
function isPrivateIp(ip: string): boolean {
  // IPv4 private ranges
  if (/^10\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;  // link-local
  if (/^127\./.test(ip)) return true;        // loopback

  // IPv4-mapped IPv6
  if (/^::ffff:10\./i.test(ip)) return true;
  if (/^::ffff:172\.(1[6-9]|2\d|3[01])\./i.test(ip)) return true;
  if (/^::ffff:192\.168\./i.test(ip)) return true;
  if (/^::ffff:169\.254\./i.test(ip)) return true;
  if (/^::ffff:127\./i.test(ip)) return true;

  // IPv6 private ranges
  if (/^fe80:/i.test(ip)) return true;       // link-local
  if (/^fd[0-9a-f]{2}:/i.test(ip)) return true; // unique local
  if (/^::1$/.test(ip)) return true;         // loopback

  return false;
}
```

### WebRTC Verdict Logic

| Condition | Verdict |
|-----------|---------|
| WebRTC not supported | `pass` (no risk) |
| Only mDNS addresses, no real local IPs | `pass` |
| STUN public IP differs from `CF-Connecting-IP` (VPN bypass) | `warn` |
| Real local/private IP addresses exposed | `fail` |

---

## Test 3: TLS Fingerprint Analysis

### Available Data (Free Tier)

The `request.cf` object exposes these TLS properties on all plans:

| Property | Type | Example |
|----------|------|---------|
| `tlsVersion` | string | `"TLSv1.3"` |
| `tlsCipher` | string | `"AEAD-AES128-GCM-SHA256"` |
| `httpProtocol` | string | `"HTTP/2"` |
| `tlsClientCiphersSha1` | string | Base64 SHA-1 of offered cipher suites |
| `tlsClientExtensionsSha1` | string | Base64 SHA-1 of TLS extensions |
| `tlsClientHelloLength` | string | Byte length of ClientHello |
| `tlsClientRandom` | string | 32-byte random value (unique per connection) |

**NOT available on free tier:** `botManagement.ja3Hash`, `botManagement.ja4` (Enterprise + Bot Management only).

### Composite TLS Profile

Since JA3/JA4 hashes are unavailable, we construct a composite TLS profile:

```typescript
// src/worker/services/tls-profiles.ts

interface TlsProfile {
  version: string;            // "TLSv1.3"
  cipher: string;             // "AEAD-AES128-GCM-SHA256"
  protocol: string;           // "HTTP/2"
  ciphersSha1: string;        // Base64 SHA-1 of cipher suite list
  extensionsSha1: string;     // Base64 SHA-1 of extensions
  helloLength: string;        // ClientHello byte length
}

function computeProfileId(profile: TlsProfile): string {
  // Combine the unique identifiers into a single hash
  // These three values together approximate a JA3-like fingerprint:
  // - ciphersSha1: identifies the set of cipher suites the client offers
  // - extensionsSha1: identifies the TLS extensions
  // - helloLength: adds a dimension based on ClientHello structure
  const raw = `${profile.version}|${profile.ciphersSha1}|${profile.extensionsSha1}|${profile.helloLength}`;
  // Use a simple hash for display (not crypto-strength needed, base-36 output)
  return simpleHash(raw);
}
```

### Known TLS Profile Database

Maintain a static lookup table of known browser TLS profiles. Built during development by testing with common browsers:

```typescript
const KNOWN_PROFILES: Record<string, string> = {
  // profileId → human-readable name
  // These values are populated during development by testing with real browsers
  // Example entries (actual values will differ):
  // "a1b2c3d4e5f6g7h8": "Chrome 120+ (Windows/macOS)",
  // "i9j0k1l2m3n4o5p6": "Firefox 130+ (all platforms)",
  // "q7r8s9t0u1v2w3x4": "Safari 17+ (macOS/iOS)",
};
```

**Building the database:** Visit `/api/analyze` from Chrome, Firefox, Safari, and Edge, and record the `profileId` for each. This populates the lookup table over time.

### TLS Verdict Logic

```typescript
function evaluateTls(profile: TlsProfile, profileId: string): TestVerdict {
  // TLSv1.2 or lower = concerning
  if (profile.version !== 'TLSv1.3') return 'warn';

  // Known common browser profile = good (less identifiable)
  if (KNOWN_PROFILES[profileId]) return 'pass';

  // Unknown profile = potentially unique/identifiable
  return 'warn';
}
```

### TLS Profile Recognition

| Rating | Criteria |
|--------|----------|
| `known` | Matches a browser profile in our static database (Chrome, Firefox, Safari, Edge) |
| `unknown` | Does not match any known profile |

Two tiers only — a small static database cannot defensibly distinguish "rare" from "unique." Display disclaimer: "Based on a limited sample of known browser profiles. For comprehensive TLS fingerprint analysis, see [JA4+ database](https://ja4db.com/)."

---

## Test 4: Browser Fingerprint Entropy

### What We Collect (Client-Side Only)

| Component | Collection Method | Typical Entropy (bits) |
|-----------|------------------|----------------------|
| User-Agent | `navigator.userAgent` | 8-10 |
| Platform | `navigator.platform` | 3-4 |
| Language | `navigator.language` + `navigator.languages` | 3-5 |
| Timezone | `Intl.DateTimeFormat().resolvedOptions().timeZone` | 3-4 |
| Screen resolution | `screen.width + 'x' + screen.height` | 4-5 |
| Color depth | `screen.colorDepth` | 1-2 |
| Device pixel ratio | `window.devicePixelRatio` | 2-3 |
| Hardware concurrency | `navigator.hardwareConcurrency` | 2-3 |
| Device memory | `navigator.deviceMemory` | 2-3 |
| Touch support | `navigator.maxTouchPoints` | 1-2 |
| Canvas fingerprint | Canvas API rendering hash | 6-10 |
| WebGL renderer | `WEBGL_debug_renderer_info` extension | 5-8 |
| WebGL vendor | Same extension | 2-3 |
| Installed fonts | Font enumeration via rendering | 4-7 |
| Do Not Track | `navigator.doNotTrack` | <1 |
| Cookie enabled | `navigator.cookieEnabled` | <1 |
| PDF viewer | `navigator.pdfViewerEnabled` | <1 |
| Audio context | `AudioContext` fingerprint | 2-5 |

### Entropy Calculation

Based on the Panopticlick / Cover Your Tracks methodology:

```typescript
// src/client/scanner/fingerprint.ts

/**
 * Calculate the surprisal (self-information) for a component value.
 *
 * Formula: I(x) = -log2(P(x))
 * Where P(x) is the probability of the value in the reference population.
 *
 * Since we don't have our own large dataset, we use estimated probabilities
 * based on published research (Eckersley 2010, AmIUnique 2024, CoverYourTracks).
 */
function calculateSurprisal(componentName: string, value: string): number {
  // Use pre-computed entropy estimates per component
  // These are based on published research and represent
  // the average surprisal for a "typical" value of each component
  return ENTROPY_ESTIMATES[componentName] ?? 0;
}

/**
 * Reference entropy estimates (bits) per component.
 * Sources: Eckersley 2010, Laperdrix et al. 2016, AmIUnique.org 2024
 *
 * These represent the SHANNON ENTROPY of each attribute —
 * the average bits of information provided by that attribute.
 * Individual values may provide more or less than the average.
 */
const ENTROPY_ESTIMATES: Record<string, number> = {
  userAgent:          10.0,
  platform:            3.5,
  language:            4.0,
  timezone:            3.0,
  screenResolution:    4.5,
  colorDepth:          1.5,
  devicePixelRatio:    2.5,
  hardwareConcurrency: 2.5,
  deviceMemory:        2.0,
  touchSupport:        1.5,
  canvas:              8.0,
  webglRenderer:       6.0,
  webglVendor:         2.5,
  fonts:               5.5,
  doNotTrack:          0.5,
  cookieEnabled:       0.3,
  pdfViewer:           0.5,
  audioContext:         3.0,
};

/**
 * Calculate total entropy estimate.
 *
 * Note: Summing Shannon entropies assumes independence between attributes,
 * which isn't strictly true (e.g., platform correlates with screen resolution).
 * Apply a correlation discount factor of 0.7 to account for this.
 *
 * Reference: Eckersley found ~18 bits effective from 8 attributes.
 * With 18 attributes, naive sum ≈ 70 bits. Discounted ≈ 49 bits.
 * Practical uniqueness threshold: ~33 bits (1 in 8 billion).
 */
const CORRELATION_DISCOUNT = 0.7;

function calculateTotalEntropy(components: FingerprintComponent[]): number {
  const naiveSum = components.reduce((sum, c) => sum + c.entropy, 0);
  return Math.round(naiveSum * CORRELATION_DISCOUNT * 10) / 10;
}
```

### Canvas Fingerprint Collection

```typescript
function getCanvasFingerprint(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 50;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'unsupported';

  // Draw text with specific font and styling — rendering differences
  // between GPUs, OS text renderers, and browser engines produce unique results
  ctx.textBaseline = 'top';
  ctx.font = '14px Arial';
  ctx.fillStyle = '#f60';
  ctx.fillRect(125, 1, 62, 20);
  ctx.fillStyle = '#069';
  ctx.fillText('LeakTest,\ud83d\ude03', 2, 15);
  ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
  ctx.fillText('LeakTest,\ud83d\ude03', 4, 17);

  // Hash the canvas data URL
  return simpleHash(canvas.toDataURL());
}
```

### Font Enumeration

```typescript
/**
 * Test for installed fonts by measuring text rendering width differences.
 * When a font is available, text rendered in that font has a different width
 * than text rendered in the fallback font.
 */
const TEST_FONTS = [
  'Arial', 'Verdana', 'Times New Roman', 'Trebuchet MS', 'Georgia',
  'Palatino', 'Garamond', 'Bookman Old Style', 'Comic Sans MS',
  'Courier New', 'Impact', 'Lucida Console', 'Tahoma',
  'Century Gothic', 'Helvetica', 'Monaco', 'Menlo',
  'Consolas', 'Calibri', 'Cambria', 'Segoe UI',
  'Ubuntu', 'Roboto', 'Noto Sans', 'Fira Code',
];

const BASELINE_FONTS = ['monospace', 'sans-serif', 'serif'];

function detectFonts(): string[] {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const testString = 'mmmmmmmmmmlli';
  const fontSize = '72px';

  // Measure baseline widths
  const baselines: Record<string, number> = {};
  for (const base of BASELINE_FONTS) {
    ctx.font = `${fontSize} ${base}`;
    baselines[base] = ctx.measureText(testString).width;
  }

  // Test each font against baselines
  const detected: string[] = [];
  for (const font of TEST_FONTS) {
    for (const base of BASELINE_FONTS) {
      ctx.font = `${fontSize} '${font}', ${base}`;
      if (ctx.measureText(testString).width !== baselines[base]) {
        detected.push(font);
        break;
      }
    }
  }

  return detected;
}
```

### AudioContext Fingerprint

```typescript
async function getAudioFingerprint(): Promise<string> {
  try {
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    const oscillator = ctx.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(10000, ctx.currentTime);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-50, ctx.currentTime);
    compressor.knee.setValueAtTime(40, ctx.currentTime);
    compressor.ratio.setValueAtTime(12, ctx.currentTime);
    compressor.attack.setValueAtTime(0, ctx.currentTime);
    compressor.release.setValueAtTime(0.25, ctx.currentTime);

    oscillator.connect(compressor);
    compressor.connect(ctx.destination);
    oscillator.start(0);

    const buffer = await ctx.startRendering();
    const data = buffer.getChannelData(0);

    // Hash a portion of the audio output
    let sum = 0;
    for (let i = 4500; i < 5000; i++) {
      sum += Math.abs(data[i]);
    }
    return sum.toFixed(6);
  } catch {
    return 'unsupported';
  }
}
```

### Fingerprint Verdict Logic

| Entropy Range | Verdict | Display |
|---|---|---|
| < 20 bits | `pass` | "Low uniqueness — you blend in with many users" |
| 20–33 bits | `warn` | "Moderate uniqueness — potentially identifiable in smaller populations" |
| > 33 bits | `fail` | "High uniqueness — your browser is likely identifiable" |

**Context:** 33 bits = 1 in 8.6 billion, roughly the world population. Above this threshold, the fingerprint is theoretically unique globally.

---

## Test 5: Cloudflare Edge PoP & IP/Geo Analysis

### Available Data

All from `request.cf` (free tier):

```typescript
// Server-side collection — all fields from request.cf
// Mapped to the client-facing GeoResult in the AnalyzeResponse
interface GeoAnalysis {
  ip: string;                   // CF-Connecting-IP header
  countryCode: string | null;   // request.cf.country (ISO 3166-1 alpha-2)
  country: string | null;       // Derived from countryCode via lookup map (Cloudflare only provides the code)
  city: string | null;          // request.cf.city
  region: string | null;        // request.cf.region
  regionCode: string | null;    // request.cf.regionCode
  postalCode: string | null;    // request.cf.postalCode
  latitude: string | null;      // request.cf.latitude
  longitude: string | null;     // request.cf.longitude
  timezone: string;             // request.cf.timezone (IANA)
  continent: string | null;     // request.cf.continent
  asn: number;                  // request.cf.asn
  asOrganization: string;       // request.cf.asOrganization
  colo: string;                 // request.cf.colo (IATA airport code)
  isEU: boolean;                // request.cf.isEUCountry === "1"
  httpProtocol: string;         // request.cf.httpProtocol
  clientTcpRtt: number | null;  // request.cf.clientTcpRtt (ms)
}
```

### Colo (Edge PoP) Analysis

The `colo` field is the three-letter IATA code of the Cloudflare data center serving the request. Examples: `DFW` (Dallas), `IAH` (Houston), `SJC` (San Jose), `AMS` (Amsterdam).

**VPN detection heuristic:** If the user's IP geolocates to Amsterdam but the Cloudflare colo is `DFW`, the user might be routing through a VPN exit node in Amsterdam while physically being near Dallas. However, Cloudflare routes to the nearest data center based on network path, so VPN users will typically hit the colo nearest to their VPN exit server, not their physical location.

**What's more useful:** Comparing the `colo` location with the `city`/`country` from IP geolocation. If they match (or are close), the user's IP and routing are consistent. A large geographic mismatch is interesting data.

### VPN Detection Heuristic

```typescript
const KNOWN_VPN_ASNS: Set<number> = new Set([
  // Known VPN provider ASNs
  // Mullvad: 39351, NordVPN: 212238, ProtonVPN: 209103,
  // Cloudflare WARP: 13335, etc.
]);

const KNOWN_DATACENTER_ASNS: Set<number> = new Set([
  // Cloud/datacenter ASNs — traffic from these is likely proxied
  // AWS, GCP, Azure, DigitalOcean, Vultr, Hetzner, etc.
]);

function detectVpn(asn: number, asOrganization: string): boolean {
  if (KNOWN_VPN_ASNS.has(asn)) return true;
  if (KNOWN_DATACENTER_ASNS.has(asn)) return true;

  // Heuristic: organization name matches VPN-related keywords (word-boundary match)
  const VPN_KEYWORDS: RegExp[] = [
    /\bvpn\b/i, /\bproxy\b/i, /\btunnel\b/i, /\bwarp\b/i,
    /\bmullvad\b/i, /\bnordvpn\b/i, /\bexpressvpn\b/i,
    /\bprotonvpn\b/i, /\bsurfshark\b/i, /\bcyberghost\b/i,
  ];
  return VPN_KEYWORDS.some(re => re.test(asOrganization));
}
```

### Geo/IP Verdict Logic

This test is informational rather than pass/fail. The verdict reflects how much the user's network reveals:

| Condition | Verdict |
|-----------|---------|
| VPN detected (known VPN ASN) | `pass` — "You're using a VPN. Your real IP is hidden." |
| Datacenter ASN (cloud proxy) | `pass` — "Traffic routed through a datacenter." |
| ISP ASN, geo matches edge PoP | `pass` — "Normal network path, no anomalies detected." |
| ISP ASN with geo mismatch vs colo | `warn` — "IP location and edge location differ." |
| Insufficient geo data | `warn` — "Not enough data to assess network path." |

---

## API Endpoint Specifications

### `GET /api/analyze`

Returns all server-side observable data in a single request.

**Response (200):**

```typescript
interface AnalyzeResponse {
  ip: string;
  geo: {
    country: string | null;      // Human-readable name, e.g. "United States"
    countryCode: string | null;  // ISO 3166-1 alpha-2, e.g. "US"
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
    coloCity: string | null;    // Looked up from IATA code, null if unmapped
    coloCountry: string | null;
    httpProtocol: string;
    clientTcpRtt: number | null;
  };
}
```

All values come from `request.cf` and `request.headers`. The `profileId` is computed from TLS properties via FNV-1a, `knownProfile` is looked up from the static database, and `coloCity`/`coloCountry` are resolved from a ~50-entry IATA code table. Responses include `Cache-Control: no-store` to prevent CDN caching of per-user data.

### `POST /api/dns/start`

Initializes a DNS leak test session.

**Request body:** None (empty POST).

**Response (200):**

```typescript
interface DnsStartResponse {
  testId: string;               // UUID generated by Worker
  probeCount: number;           // 10
  probeHostnames: string[];     // ["1.{bashWsId}.bash.ws", ...]
  delayBetweenProbesMs: number; // 200
  waitAfterProbesMs: number;    // 3000
}
```

The handler generates a UUID `testId`, calls `DnsTestBackend.startTest()` for probe configuration, stores the session in KV (`dns:{testId}` → `{ bashWsId, status: "probing", startedAt }`), and returns the probe configuration to the client.

### `GET /api/dns/check/:testId`

Polls for DNS leak test results.

**Response (200):**

```typescript
// Returns raw resolver data — verdict is computed client-side via evaluateDnsLeak()
interface DnsCheckResponse {
  status: 'pending' | 'complete' | 'error';
  resolvers: ResolverInfo[];
  message: string | null;       // Human-readable status
}

// Simplified to what bash.ws actually provides (IP + country)
interface ResolverInfo {
  ip: string;
  country: string;
  countryCode: string;
}
```

**Note:** The verdict is computed CLIENT-SIDE in the runner (not in the Worker), because it needs both resolver data from `/api/dns/check` and geo/VPN data from `/api/analyze`. The Worker just returns raw resolver data.

If `/api/analyze` fails but the DNS test returns resolver data, the runner assigns a `'warn'` verdict to the DNS result. The resolvers were observed, so the test is not an error, but without geo context the system cannot determine whether the resolver countries indicate a leak. The `leakDetected` flag remains `false` in this scenario because leak detection requires geo comparison.

The handler reads the session from KV (`dns:{testId}`), returns 404 if not found, then calls `DnsTestBackend.getResults(bashWsId)`. Pending results return `{ status: "pending" }`; completed results return the raw resolver data. KV keys auto-expire via the 60s TTL.

---

## Worker Router

```typescript
// src/worker/index.ts

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.hostname;

    // API routes
    if (url.pathname.startsWith('/api/')) {
      // CORS headers — configured via required env var. No wildcard fallback.
      const corsHeaders = {
        'Access-Control-Allow-Origin': env.CORS_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      let response: Response;

      if (url.pathname === '/api/analyze' && request.method === 'GET') {
        response = await handleAnalyze(request, env);
      } else if (url.pathname === '/api/dns/start' && request.method === 'POST') {
        response = await handleDnsStart(request, env);
      } else if (url.pathname.startsWith('/api/dns/check/') && request.method === 'GET') {
        const testId = url.pathname.split('/').pop()!;
        response = await handleDnsCheck(testId, env);
      } else {
        response = new Response('Not Found', { status: 404 });
      }

      // Apply both CORS and security headers (clones response to avoid mutating immutable headers)
      return addSecurityHeaders(response, corsHeaders);
    }

    // Static file serving (frontend) — apply security headers globally
    const assetResponse = await env.ASSETS.fetch(request);
    return addSecurityHeaders(assetResponse);
  }
};

/** Apply security headers to all responses. Optional extraHeaders for CORS on API routes. */
function addSecurityHeaders(response: Response, extraHeaders?: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // CSP only on HTML responses (not JS/CSS/images)
  if (response.headers.get('content-type')?.includes('text/html')) {
    headers.set('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "font-src 'self'",
      "img-src 'self' https://*.bash.ws data:",
      "connect-src 'self'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '));
  }
  return new Response(response.body, { status: response.status, headers });
}
```

*The probe handler is part of the future self-hosted DNS architecture. See "Future: Self-Hosted DNS Server" for details.*

---

## TypeScript Types (Shared)

```typescript
// src/client/scanner/types.ts (client-side types)
// src/worker/types.ts (worker-side types, including Env)

// === Grades & Verdicts ===

type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
type TestStatus = 'pending' | 'running' | 'complete' | 'error' | 'skipped';
type TestVerdict = 'pass' | 'warn' | 'fail';

// === Individual Test Results ===

interface TestResult<T = unknown> {
  id: string;
  name: string;
  status: TestStatus;
  verdict: TestVerdict | null;
  data: T | null;
  error: string | null;
  durationMs: number;
}

interface DnsLeakResult {
  resolvers: ResolverInfo[];
  leakDetected: boolean;
  resolverCount: number;
}

interface ResolverInfo {
  ip: string;
  country: string;
  countryCode: string;
}

interface WebRtcResult {
  webrtcSupported: boolean;
  localIps: string[];
  publicIp: string | null;
  mdnsAddresses: string[];
  leakDetected: boolean;
}

interface TlsResult {
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

interface FingerprintResult {
  entropy: number;
  components: FingerprintComponent[];
  uniqueAmong: number;   // Estimated "1 in N"
}

interface FingerprintComponent {
  name: string;
  value: string;
  entropy: number;
}

interface GeoResult {
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

// === Aggregate Results ===

interface ScanResults {
  sessionId: string;
  timestamp: number;
  dns: TestResult<DnsLeakResult>;
  webrtc: TestResult<WebRtcResult>;
  tls: TestResult<TlsResult>;
  fingerprint: TestResult<FingerprintResult>;
  geo: TestResult<GeoResult>;
  overallGrade: Grade;
}

// === Worker Environment ===

interface Env {
  LEAK_STORE: KVNamespace;
  ASSETS: Fetcher;           // Static assets binding
  ENVIRONMENT: string;
  CORS_ORIGIN: string;       // Required: set to your production domain
}
```

---

## Error Handling

### Per-Test Error Handling

Each test runs independently. If one test fails, the others still complete.

| Test | Possible Errors | Handling |
|------|----------------|----------|
| DNS Leak | bash.ws unreachable, timeout, rate limit | `status: "error"`, message: "DNS test service temporarily unavailable" |
| DNS Leak (partial) | DNS resolvers returned but `/api/analyze` failed (no geo context) | `status: "complete"`, `verdict: "warn"`, `leakDetected: false`. Resolver data displayed but leak evaluation is inconclusive. |
| WebRTC | `RTCPeerConnection` undefined (e.g., disabled) | `verdict: "pass"`, note "WebRTC is disabled in your browser" |
| TLS | Missing `cf` properties (shouldn't happen on Cloudflare) | Use fallback values, `verdict: "warn"` |
| Fingerprint | Canvas/WebGL/Audio blocked (e.g., Brave, Tor) | Report component as "blocked", reduce entropy estimate |
| Geo/IP | Missing geo fields | Display "Unknown" for missing fields |

### Worker Error Handling

All handlers are wrapped in a try/catch that returns a generic `{ error: 'Internal error' }` JSON response with status 500, preventing internal details from leaking to clients.

### Client-Side Error State Rendering

The frontend renders three distinct error states when a scan fails:

| Type | Trigger | Icon | Title |
|------|---------|------|-------|
| `network` | `fetch()` throws `TypeError` (offline/unreachable) | `\u26A0` | Network Error |
| `timeout` | Scan exceeds overall timeout or all polls exhausted | `\u23F1` | Scan Timed Out |
| `service` | bash.ws specifically unreachable (DNS test error) | `\u26D4` | Service Unavailable |

Each renders into the scanning state container with an icon, title, message, and "Try Again" button. The "Try Again" button calls `startScan()` to retry in-place rather than reloading the page. See `docs/frontend.md` "Error States" section for full CSS and TypeScript.

### Cancel Scan Flow

Users can abort a scan mid-flight via the "Cancel Scan" button or the `Escape` key:

1. `App.startScan()` creates an `AbortController` and stores it
2. The `AbortSignal` is passed to `runAllTests(signal)`
3. All `fetch()` calls include `{ signal }` — aborting cancels in-flight requests
4. Non-fetch tests (WebRTC, fingerprint) are guarded by `signal?.throwIfAborted()` before each await
5. On cancel, `App` catches the `AbortError`, transitions back to idle, shows "Scan cancelled" toast
6. The cancel button uses `{ once: true }` to auto-remove its listener
7. A `scanGeneration` counter prevents the `finally` block of a cancelled scan from removing a newer scan's cancel listener in rapid cancel-rescan sequences

### Client-Side Error Handling

The runner awaits each test sequentially (network analysis, WebRTC, fingerprint, DNS) with `signal?.throwIfAborted()` guards between steps. Errors are handled per-test via `errorResult()` (defined in `scanner/runner.ts`). Each test returns a raw result; the runner wraps it in `TestResult<>` and assigns the verdict.

Additional hardening measures:
- `evaluateDnsLeak` filters empty country codes from the resolver set before comparison, preventing false mismatches when bash.ws returns incomplete data. For VPN users, it detects mixed-country resolver sets: if any resolver country differs from the VPN exit country, the verdict is 'fail', even when the VPN country is also present. For non-VPN users, if all resolvers lack geo data, the function returns 'warn' rather than a false 'pass'.
- The `/api/dns/check/:testId` route validates testId format against a UUID regex before any KV lookup or handler invocation.
- DNS proxy error responses use generic messages rather than forwarding raw backend error strings.
- `pollDnsResults` checks `resp.ok` before calling `resp.json()`, returning a clean error result for HTTP failures instead of a low-level parse error.
- Worker-side fetches to bash.ws use a 10-second `AbortController` timeout to fail predictably rather than relying solely on platform defaults.
- TLS verdict defaults to 'pass' for TLS 1.3 connections regardless of profile database state. The KNOWN_PROFILES lookup enriches detail reporting but does not gate the verdict.
- When DNS resolvers return but geo data is unavailable (because `/api/analyze` errored), the runner assigns `verdict: 'warn'` via `assignDnsVerdict` rather than leaving it `null`. This prevents the contradictory state where the UI shows an ERROR badge alongside "no leak found" text.

---

## Request/Response Timing

### Full Scan Timeline

```
t=0.0s    User clicks "Scan"
t=0.0s    ├─ Start: POST /api/dns/start (background, non-blocking)
t=0.0s    └─ Start: GET /api/analyze (IP, geo, TLS, edge)
t=0.3s    ├─ Complete: /api/analyze → yield progress (step 1)
t=0.3s    └─ Start: WebRTC ICE gathering
t=3.0s    ├─ Complete: WebRTC → yield progress (step 2)
t=3.0s    └─ Start: Browser fingerprint collection
t=3.2s    ├─ Complete: Fingerprint → yield progress (step 3)
t=3.2s    └─ Start: DNS probe sequence (10 probes, 200ms apart)
t=5.2s    ├─ Complete: DNS probes sent, wait 3s
t=8.2s    └─ Start: GET /api/dns/check/{testId} (first poll)
t=8.5s    ├─ If results ready: compute verdict, display results
t=10.5s   ├─ If not ready: Second poll
t=12.5s   └─ Third poll (final attempt)
```

**Total time:** 8-13 seconds depending on DNS test responsiveness. Network/WebRTC/fingerprint complete in ~3s, DNS probing + polling takes the remainder.

### Parallel vs Sequential

- `/api/dns/start` fires in background at scan start
- `/api/analyze` runs first (fastest — single fetch)
- WebRTC and fingerprint run **sequentially** after analyze completes
- DNS probes + polling run last (naturally the slowest step)
- DNS probes run **sequentially** (200ms between each) after `/api/dns/start` returns
- DNS result polling starts after probes complete + 3s wait
- Everything else is independent and non-blocking

---

## Static Data Tables

### IATA Colo Code Lookup (Top 50)

```typescript
// src/worker/services/tls-profiles.ts (or a shared data file)

const COLO_LOOKUP: Record<string, { city: string; country: string }> = {
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
  // ... extend as needed
};
```
