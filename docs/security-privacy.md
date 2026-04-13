# Security & Privacy — DNS Leak Tester

## Principles

This is a privacy diagnostic tool. It must practice what it preaches:

1. **Collect only what's needed** — Only gather data required for the diagnostic tests.
2. **No server-side persistence** — KV data auto-expires in 60 seconds. Shared result URLs persist only if the user copies/shares them.
3. **Transparency** — Users can see exactly what data is collected and where it goes.
4. **No tracking** — No analytics, no cookies, no third-party tracking scripts.
5. **Client-side by default** — Run as much as possible in the browser, not the server.

---

## Data Collection Inventory

### What the Tool Collects

| Data | Where Collected | Where Sent | Retained? |
|------|----------------|------------|-----------|
| IP address | Server (CF-Connecting-IP) | Displayed to user | Not stored. Displayed during scan only. |
| Geolocation (country, city, region) | Server (request.cf) | Displayed to user | Not stored |
| ASN / ISP name | Server (request.cf) | Displayed to user | Not stored |
| TLS version, cipher, extensions | Server (request.cf) | Displayed to user | Not stored |
| TLS profile hash | Computed server-side | Displayed to user | Not stored |
| Cloudflare edge PoP | Server (request.cf.colo) | Displayed to user | Not stored |
| DNS resolver IPs | Third-party (bash.ws) | Displayed to user | bash.ws retains per their policy |
| WebRTC ICE candidates | Client-side (browser) | Displayed to user | Not stored; not sent to server |
| Canvas fingerprint hash | Client-side (browser) | Displayed to user | Not stored; not sent to server |
| WebGL renderer/vendor | Client-side (browser) | Displayed to user | Not stored; not sent to server |
| Audio fingerprint | Client-side (browser) | Displayed to user | Not stored; not sent to server |
| Installed fonts list | Client-side (browser) | Displayed to user | Not stored; not sent to server |
| Screen resolution | Client-side (browser) | Displayed to user | Not stored; not sent to server |
| Browser metadata (UA, lang, etc.) | Client-side (browser) | Displayed to user | Not stored; not sent to server |
| Entropy score | Computed client-side | Displayed to user | Not stored; not sent to server |

### What the Tool Does NOT Collect

- No cookies are set (no session cookies, no tracking cookies)
- No localStorage or sessionStorage is used
- No user accounts or authentication
- No email addresses, names, or personal identifiers
- No browsing history tracking. `Referrer-Policy: no-referrer` header prevents referrer leaking to third parties.
- No analytics (no Google Analytics, no Plausible, no Cloudflare Analytics)
- No third-party scripts (except STUN server interaction for WebRTC test and bash.ws DNS leak test API proxied through our Worker)
- No server-side logging of user activity (Worker logs are ephemeral and not configured)
- The full browser fingerprint vector is never sent to the server or stored — it exists only in the browser's JavaScript runtime during the scan

---

## Data Flow

### Server-Side Data (Cloudflare Worker)

```
Browser → HTTPS → Cloudflare Edge → Worker

Worker reads from request:
  - CF-Connecting-IP header → user's IP
  - request.cf object → geo, ASN, TLS metadata, colo

Worker returns:
  - JSON response with all above data
  - Response is NOT logged, NOT stored
  - Cache-Control: no-store (prevents CDN caching)

Worker writes to KV (DNS test only):
  - Key: dns:{testId}
  - Value: { bashWsId, status, startedAt }
  - TTL: 60 seconds (auto-deleted)
```

### Client-Side Data (Browser)

```
Browser JavaScript:
  - Collects fingerprint components (canvas, WebGL, fonts, etc.)
  - All data stays in JavaScript runtime memory
  - Displayed in the DOM for the user
  - NEVER sent to the server
  - Cleared when user navigates away or closes tab
```

### Third-Party Data (DNS Leak Test)

```
DNS Leak Test Flow:
  1. Worker → bash.ws: GET /id (fetches test ID)
  2. Browser → bash.ws subdomains: DNS resolution (resolver IPs logged by bash.ws)
  3. Worker → bash.ws: GET /dnsleak/test/{id}?json (fetches resolver IPs)

Data sent to bash.ws:
  - DNS queries from user's resolver (exposes resolver IP to bash.ws)
  - Direct HTTPS image requests from user's browser to *.bash.ws subdomains
    (exposes user's IP and User-Agent to bash.ws; referrer is blocked by Referrer-Policy: no-referrer)
  - API calls from our Worker IP (not the user's IP) for test ID and results

bash.ws privacy note:
  - bash.ws sees BOTH the user's DNS resolver IP AND the user's browsing IP
    (via the probe image HTTP requests)
  - This is a significant privacy trade-off of using a third-party backend
  - The test ID is randomly generated and ephemeral
  - bash.ws retention policy is unknown — document this as a limitation
```

### WebRTC STUN Server

```
WebRTC Test Flow:
  Browser → stun:stun.l.google.com:19302 (STUN request)

Data sent to Google's STUN server:
  - UDP packet with the browser's public IP
  - This is standard WebRTC behavior, not unique to our tool
  - Google's STUN server returns the browser's reflexive address

Note: The STUN server interaction reveals the user's public IP to Google.
This is the same thing that happens on any WebRTC-enabled website.
```

---

## Share Feature Privacy

When users click "Share Results", the results are encoded in the URL fragment (`#r=...`).

**What IS included in the shared URL:**
- Overall grade (A–F)
- Per-test verdicts (pass/warn/fail)
- Per-test summary text (human-readable descriptions)
- Timestamp

**What is NOT included in the shared URL:**
- IP address
- Raw fingerprint component values
- Individual resolver IPs
- ASN or ISP name
- Geolocation details
- TLS properties
- WebRTC candidate details

**The fragment is never sent to the server** — URL fragments (everything after `#`) are not included in HTTP requests per the URL specification. The encoded data exists only in the user's browser and in whatever medium they share the link through (chat, email, etc.).

---

## Threat Model

### Threats FROM the Tool

| Threat | Risk Level | Analysis |
|--------|-----------|----------|
| Tool operator (you) collects user data | **Mitigated** | No persistent storage, no logging configured. KV has 60s TTL. Cloudflare Workers do not log request bodies by default. |
| Cloudflare collects user data | **Accepted** | Cloudflare processes all requests as the CDN/edge provider. They have their own privacy policy. This is inherent to using Cloudflare and not unique to this tool. |
| bash.ws collects user + resolver data | **Accepted, documented** | bash.ws sees the user's DNS resolver IP (via DNS queries) AND the user's browsing IP (via probe image HTTP requests). Documented in data flow section. |
| Google STUN server logs connections | **Accepted, standard** | The STUN server interaction is standard WebRTC behavior. |
| Shared results URL leaks data | **Mitigated** | Only verdicts and summaries are encoded, not raw data. No IPs, no fingerprints. |
| XSS attack via shared results | **Mitigated** | Summary text rendered via `textContent` (not `innerHTML`). URL fragment is parsed with `JSON.parse` and validated: version check, field existence, verdict allowlist (`pass/warn/fail/error`), grade allowlist (`A/B/C/D/F`), string length cap. Grade text in the SVG gauge is set via `textContent` (not interpolated into `innerHTML`). Verdict classes validated against allowlist before use in HTML attributes. `escapeHtml()` covers both text content and attribute contexts (including quote escaping). |
| Cross-origin data exposure | **Mitigated** | Production CORS is restricted to the deployment origin via `CORS_ORIGIN` in wrangler.toml. Local dev uses `.dev.vars` override. |

### Threats TO the Tool

| Threat | Risk Level | Analysis |
|--------|-----------|----------|
| Malicious Worker lies about results | **Low** | The Worker is deployed by the project owner. Users must trust the operator, same as any web-based security tool. For maximum trust, users can audit the open-source code and run their own instance. |
| DNS probe technique blocked by resolver | **Low** | Some corporate DNS resolvers may not forward queries to bash.ws. The test would fail gracefully. |
| bash.ws goes offline | **Medium** | DNS leak test would fail. Error handling returns a clear message. The test is isolated — other tests still work. |
| Rate limiting by Cloudflare free tier | **Low** | 100K requests/day is generous for a personal tool. |
| DDoS against the tool | **Low** | Cloudflare provides DDoS protection even on the free tier. |
| Man-in-the-middle attack | **Low** | All connections are HTTPS (Cloudflare provides SSL). |

### Can Users Trust the Results?

| Test | Trust Level | Why |
|------|------------|-----|
| DNS Leak | **High** | Resolver IPs come from bash.ws's authoritative DNS server, which has ground truth about which resolver queried it. |
| WebRTC | **High** | ICE candidate gathering happens entirely in the browser. The tool reports what the browser provides. |
| TLS Fingerprint | **Medium** | The Worker reports what Cloudflare observes in the TLS handshake. This is accurate for the Cloudflare connection but may differ from what other servers see (due to Cloudflare's TLS termination). |
| Browser Fingerprint | **Medium** | Client-side collection is accurate. Entropy estimates are approximate (based on published research, not a live dataset). |
| Geo/IP | **High** | Cloudflare's IP geolocation is generally accurate. ASN data is authoritative. |

---

## Security Headers

The Worker sets these headers on all responses:

```typescript
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' https://*.bash.ws data:",  // bash.ws for DNS probe images
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};
```

**CSP notes:**
- `script-src 'self'` — No inline scripts, no external scripts. All JS is bundled by Vite.
- `img-src` includes `*.bash.ws` for DNS probe images and `data:` for canvas fingerprint data URLs and the inline SVG favicon.
- `connect-src 'self'` — API calls to bash.ws go through the Worker proxy. Probe images ARE loaded directly from `*.bash.ws` subdomains (covered by `img-src`, not `connect-src`).
- `frame-src 'none'` — Tool should not be embedded in iframes.
- `style-src 'self'` — No inline styles. All dynamic styling (grade ring animation, entropy bar widths) is applied via the JavaScript DOM API (`element.style.setProperty`), which is CSP-compliant without `'unsafe-inline'`. Fonts are self-hosted (no Google Fonts CDN).
- `Permissions-Policy` explicitly denies camera/microphone (WebRTC test uses data channels, not media).

---

## Privacy Notice

The following privacy notice is displayed on the site:

**What the tool checks:** DNS resolver (leak detection), WebRTC ICE candidates (IP leak detection), TLS fingerprint (uniqueness assessment), browser properties (entropy estimation), IP and network info (VPN detection).

**What stays in the browser:** The browser fingerprint (canvas, WebGL, fonts, audio) is computed locally and never sent to any server.

**What touches the server:** IP, location, and TLS metadata are read from the network connection to generate the report. This data is not stored or logged.

**What touches third parties:** The DNS leak test uses bash.ws, which sees both the user's DNS resolver IP and browsing IP via probe image requests. The WebRTC test contacts Google's STUN server (standard WebRTC behavior).

**What is stored:** Nothing persistent. Temporary test data exists for 60 seconds, then is automatically deleted.

**Sharing:** Results are encoded in the URL fragment (`#`). Only grades and summary text are included — no IPs, fingerprints, or raw data. The fragment is never sent to the server.

Source code: [github.com/ygbull/DNSLeakTester](https://github.com/ygbull/DNSLeakTester)

---

## Security Policy

For vulnerability reports, open a GitHub issue at [github.com/ygbull/DNSLeakTester](https://github.com/ygbull/DNSLeakTester/issues) or email via the contact information on the GitHub profile.

**Scope:** This is a client-side network diagnostic tool. It does not handle authentication, store persistent user data, or process payments. Security-relevant areas include XSS prevention (all output escaped), CSP headers, third-party API interaction (bash.ws), and URL fragment encoding/decoding.

**Architecture:** Vanilla TypeScript frontend, Cloudflare Workers backend (serverless, no persistent storage), Cloudflare KV with 60-second TTL. Zero runtime dependencies.

---

## Compliance Considerations

### GDPR

- **IP addresses are personal data under GDPR.** The tool processes IP addresses transiently to generate the diagnostic report.
- **No storage** beyond 60-second KV TTL mitigates most GDPR concerns.
- **bash.ws interaction** sends DNS queries from the user's resolver to a third-party service. The resolver IP may be considered personal data.
- **Recommendation:** Include the privacy notice on the site. The notice above covers the Article 13 information requirements (what data, why, who processes it).
- Since this is a free, open-source, personal project with no accounts, GDPR obligations are minimal. The biggest concern is bash.ws's data handling, which is documented as a limitation.

### Cookie Law

- **No cookies are used.** No cookie consent banner needed.

### CCPA

- **No sale of personal information.** No personal information is stored.
- Minimal exposure — this is a diagnostic tool, not a data collection service.
