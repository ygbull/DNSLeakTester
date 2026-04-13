import type {
  Grade, ScanResults, TestResult, DnsLeakResult,
  WebRtcResult, TlsResult, FingerprintResult, GeoResult,
} from '../scanner/types';
import { escapeHtml, truncate } from '../utils/dom';

const GRADE_VALUES: Record<string, number> = { A: 100, B: 80, C: 60, D: 40, F: 20 };
const GRADE_COLORS: Record<string, string> = {
  A: '#10B981', B: '#10B981', C: '#F59E0B', D: '#EF4444', F: '#EF4444',
};

export function renderGradeGauge(grade: Grade): HTMLElement {
  const percent = GRADE_VALUES[grade] ?? 20;
  const color = GRADE_COLORS[grade] ?? '#EF4444';
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percent / 100);

  const container = document.createElement('div');
  container.className = 'grade-gauge';
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', `Overall privacy grade: ${grade}`);

  container.innerHTML = `
    <svg viewBox="0 0 120 120" width="140" height="140">
      <circle cx="60" cy="60" r="${radius}"
        fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="8" />
      <circle cx="60" cy="60" r="${radius}"
        fill="none" stroke="${color}" stroke-width="8"
        stroke-linecap="round"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${circumference}"
        class="grade-ring"
        transform="rotate(-90 60 60)" />
      <text x="60" y="60" text-anchor="middle" dominant-baseline="central"
        class="grade-letter"
        fill="${color}" font-size="36" font-weight="700"
        font-family="'JetBrains Mono', monospace"></text>
    </svg>
    <p class="grade-context">This grade reflects network privacy posture, not security. An F doesn't mean you're unsafe — it means your network identity is visible.</p>
  `;

  // Set grade text safely via textContent (never interpolate into innerHTML)
  container.querySelector('.grade-letter')!.textContent = grade;

  // Set CSS custom properties via JS to comply with style-src 'self' CSP
  const ring = container.querySelector('.grade-ring') as HTMLElement;
  if (ring) {
    ring.style.setProperty('--start-offset', `${circumference}px`);
    ring.style.setProperty('--target-offset', `${dashOffset}px`);
  }

  return container;
}

export function renderReportCard(container: HTMLElement, results: ScanResults): void {
  container.innerHTML = '';

  container.appendChild(renderGradeGauge(results.overallGrade));

  // Render test cards in order: geo, dns, webrtc, tls, fingerprint
  const tests: TestResult[] = [
    results.geo,
    results.dns,
    results.webrtc,
    results.tls,
    results.fingerprint,
  ];

  for (const result of tests) {
    container.appendChild(renderTestCard(result));
  }
}

const VALID_VERDICTS = ['pass', 'warn', 'fail', 'error'];

function renderTestCard(result: TestResult): HTMLElement {
  const card = document.createElement('div');
  card.className = 'test-card';

  const rawVerdict = result.verdict ?? 'error';
  const verdictClass = VALID_VERDICTS.includes(rawVerdict) ? rawVerdict : 'error';
  const verdictText = result.status === 'error' ? 'ERROR' : verdictClass.toUpperCase();

  // Header
  const header = document.createElement('div');
  header.className = 'test-card-header';

  const badge = document.createElement('span');
  badge.className = `verdict-badge ${verdictClass}`;
  badge.textContent = verdictText;

  const title = document.createElement('span');
  title.className = 'test-card-title';
  title.textContent = result.name;

  const duration = document.createElement('span');
  duration.className = 'test-card-duration mono';
  duration.textContent = result.durationMs > 0 ? `${result.durationMs}ms` : '';

  header.appendChild(badge);
  header.appendChild(title);
  header.appendChild(duration);

  // Summary (textContent for XSS safety)
  const summary = document.createElement('div');
  summary.className = 'test-card-summary';
  summary.textContent = getSummaryText(result);

  // Details
  const detailsWrapper = document.createElement('div');
  detailsWrapper.className = 'test-card-details';
  detailsWrapper.id = `details-${result.id}`;
  const detailsInner = document.createElement('div');
  detailsInner.innerHTML = getDetailsHtml(result);
  // Set entropy bar widths via JS instead of inline style (CSP compliance)
  detailsInner.querySelectorAll('.entropy-bar[data-width]').forEach(bar => {
    (bar as HTMLElement).style.width = `${bar.getAttribute('data-width')}%`;
    bar.removeAttribute('data-width');
  });
  detailsWrapper.appendChild(detailsInner);

  // Toggle button
  const toggle = document.createElement('button');
  toggle.className = 'test-card-toggle';
  toggle.textContent = 'Show details';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => {
    const isOpen = detailsWrapper.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.textContent = isOpen ? 'Hide details' : 'Show details';
  });

  card.appendChild(header);
  card.appendChild(summary);
  card.appendChild(detailsWrapper);
  card.appendChild(toggle);

  return card;
}

function getSummaryText(result: TestResult): string {
  if (result.status === 'error') return result.error ?? 'Test failed';

  switch (result.id) {
    case 'dns': {
      const data = result.data as DnsLeakResult;
      const s = data.resolverCount === 1 ? '' : 's';
      if (data.leakDetected) return `${data.resolverCount} resolver${s} detected — possible DNS leak.`;
      if (result.verdict === 'warn') return `${data.resolverCount} resolver${s} detected — check inconclusive.`;
      return `${data.resolverCount} resolver${s} detected — no leak found.`;
    }
    case 'webrtc': {
      const data = result.data as WebRtcResult;
      if (!data.webrtcSupported) return 'WebRTC is disabled in your browser.';
      if (data.leakDetected) return `Local IP exposed: ${data.localIps.join(', ')}`;
      if (data.publicIp && result.verdict === 'warn')
        return `Different public IP via STUN: ${data.publicIp}`;
      if (data.mdnsAddresses.length > 0) return 'Local IPs hidden behind mDNS. No leak.';
      return 'No IP addresses exposed via WebRTC.';
    }
    case 'tls': {
      const data = result.data as TlsResult;
      const profile = data.knownProfile ?? 'Unknown profile';
      return `${data.version}, ${data.cipher}. Profile: ${profile} (${data.commonality}).`;
    }
    case 'fingerprint': {
      const data = result.data as FingerprintResult;
      return `${data.entropy} bits of entropy — approximately 1 in ${data.uniqueAmong.toLocaleString()} browsers.`;
    }
    case 'geo': {
      const data = result.data as GeoResult;
      const vpn = data.isVpnLikely ? 'VPN detected. ' : '';
      return `${vpn}${data.ip} — ${data.city ?? 'Unknown'}, ${data.country ?? 'Unknown'} (${data.asOrganization})`;
    }
    default: return '';
  }
}

function getDetailsHtml(result: TestResult): string {
  if (!result.data) return '<p class="detail-note">No data available.</p>';

  switch (result.id) {
    case 'dns': return renderDnsDetails(result.data as DnsLeakResult);
    case 'webrtc': return renderWebRtcDetails(result.data as WebRtcResult);
    case 'tls': return renderTlsDetails(result.data as TlsResult);
    case 'fingerprint': return renderFingerprintDetails(result.data as FingerprintResult);
    case 'geo': return renderGeoDetails(result.data as GeoResult);
    default: return '';
  }
}

function renderDnsDetails(data: DnsLeakResult): string {
  if (data.resolvers.length === 0) return '<p class="detail-note">No resolver data available.</p>';
  const rows = data.resolvers.map(r =>
    `<tr><td class="mono">${escapeHtml(r.ip)}</td><td>${escapeHtml(r.country)}</td><td>${escapeHtml(r.countryCode)}</td></tr>`
  ).join('');
  return `<div class="detail-table-wrap"><table class="detail-table">
    <thead><tr><th>Resolver IP</th><th>Country</th><th>Code</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderWebRtcDetails(data: WebRtcResult): string {
  if (!data.webrtcSupported) return '<p class="detail-note">WebRTC is not available in this browser.</p>';
  const items: string[] = [];
  for (const ip of data.localIps) items.push(`<tr><td class="mono">${escapeHtml(ip)}</td><td>Local IP (leaked!)</td></tr>`);
  for (const addr of data.mdnsAddresses) items.push(`<tr><td class="mono">${escapeHtml(addr)}</td><td>mDNS (protected)</td></tr>`);
  if (data.publicIp) items.push(`<tr><td class="mono">${escapeHtml(data.publicIp)}</td><td>STUN public IP</td></tr>`);
  if (items.length === 0) return '<p class="detail-note">No ICE candidates gathered.</p>';
  return `<div class="detail-table-wrap"><table class="detail-table">
    <thead><tr><th>Address</th><th>Type</th></tr></thead>
    <tbody>${items.join('')}</tbody>
  </table></div>`;
}

function renderTlsDetails(data: TlsResult): string {
  const rows = [
    ['TLS Version', data.version],
    ['Cipher', data.cipher],
    ['Protocol', data.protocol],
    ['Profile ID', data.profileId],
    ['Known Profile', data.knownProfile ?? 'Unknown'],
    ['Commonality', data.commonality],
    ['Cipher Suite Hash', data.ciphersSha1],
    ['Extensions Hash', data.extensionsSha1],
    ['ClientHello Length', data.helloLength],
  ].map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td class="mono detail-value">${escapeHtml(v)}</td></tr>`).join('');
  return `<div class="detail-table-wrap"><table class="detail-table">
    <thead><tr><th>Property</th><th>Value</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <p class="detail-note">Based on a limited sample of known browser profiles. For comprehensive TLS fingerprint analysis, see <a href="https://ja4db.com/" target="_blank" rel="noopener">JA4+ database</a>.</p>`;
}

function renderFingerprintDetails(data: FingerprintResult): string {
  const maxEntropy = Math.max(...data.components.map(c => c.entropy), 1);
  const rows = data.components.map(c => `
    <tr>
      <td class="mono">${escapeHtml(c.name)}</td>
      <td class="mono detail-value" title="${escapeHtml(c.value)}">${escapeHtml(truncate(c.value, 30))}</td>
      <td>
        <div class="entropy-bar-container">
          <div class="entropy-bar" data-width="${(c.entropy / maxEntropy) * 100}"></div>
        </div>
        <span class="mono">${c.entropy.toFixed(1)}b</span>
      </td>
    </tr>
  `).join('');
  return `<div class="detail-table-wrap"><table class="detail-table">
    <thead><tr><th>Component</th><th>Value</th><th>Entropy</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <p class="detail-note">Total: ${data.entropy.toFixed(1)} bits (with 0.7x correlation discount). Higher = more unique.</p>`;
}

function renderGeoDetails(data: GeoResult): string {
  const rows = [
    ['IP Address', data.ip],
    ['Country', `${data.country ?? 'Unknown'} (${data.countryCode ?? '??'})`],
    ['City', data.city ?? 'Unknown'],
    ['Region', data.region ?? 'Unknown'],
    ['Timezone', data.timezone],
    ['Continent', data.continent ?? 'Unknown'],
    ['EU Country', data.isEU ? 'Yes' : 'No'],
    ['ASN', String(data.asn)],
    ['Organization', data.asOrganization],
    ['VPN Likely', data.isVpnLikely ? 'Yes' : 'No'],
    ['Edge PoP', `${data.colo}${data.coloCity ? ` (${data.coloCity}${data.coloCountry ? `, ${data.coloCountry}` : ''})` : ''}`],
    ['HTTP Protocol', data.httpProtocol],
  ].map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td class="mono">${escapeHtml(v)}</td></tr>`).join('');
  return `<div class="detail-table-wrap"><table class="detail-table">
    <thead><tr><th>Property</th><th>Value</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}
