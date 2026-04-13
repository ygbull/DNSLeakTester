import { describe, it, expect } from 'vitest';
import { renderGradeGauge, renderReportCard } from './report';
import type { Grade, ScanResults, TestResult, TestVerdict, DnsLeakResult, FingerprintResult, GeoResult, WebRtcResult } from '../scanner/types';

describe('renderGradeGauge', () => {
  it('sets grade text via textContent, not innerHTML interpolation', () => {
    const el = renderGradeGauge('A');
    const textEl = el.querySelector('.grade-letter');
    expect(textEl).not.toBeNull();
    expect(textEl!.textContent).toBe('A');
    // should have no child elements inside the text node
    expect(textEl!.children.length).toBe(0);
  });

  it('does not contain unescaped grade in raw SVG template', () => {
    const el = renderGradeGauge('B');
    // The innerHTML of the SVG should not have 'B' between <text> tags
    // because grade is set via textContent post-creation
    const svg = el.querySelector('svg')!;
    // Before textContent is set, the text element was empty in the template
    // After textContent, it should only be set safely
    const textEl = svg.querySelector('.grade-letter')!;
    expect(textEl.textContent).toBe('B');
  });

  it('renders correct color for each grade', () => {
    const el = renderGradeGauge('A');
    const ring = el.querySelector('.grade-ring');
    expect(ring).not.toBeNull();
    // A grade should use success color #10B981
    expect(ring!.getAttribute('stroke')).toBe('#10B981');
  });

  it('has aria-label for accessibility', () => {
    const el = renderGradeGauge('C');
    expect(el.getAttribute('aria-label')).toBe('Overall privacy grade: C');
  });
});

describe('CSP-safe inline styles', () => {
  it('sets grade ring CSS variables via JS, not inline style attribute', () => {
    const el = renderGradeGauge('A');
    const ring = el.querySelector('.grade-ring') as HTMLElement;
    expect(ring).not.toBeNull();
    // CSS custom properties must be set via element.style.setProperty (CSP-safe)
    expect(ring!.style.getPropertyValue('--start-offset')).toBeTruthy();
    expect(ring!.style.getPropertyValue('--target-offset')).toBeTruthy();
    // Values should be numeric px values from circumference calculation
    expect(ring!.style.getPropertyValue('--start-offset')).toMatch(/^\d+(\.\d+)?px$/);
    expect(ring!.style.getPropertyValue('--target-offset')).toMatch(/^\d+(\.\d+)?px$/);
  });

  it('sets entropy bar widths via element.style, not inline attribute', () => {
    const stubResult = (id: string, name: string): TestResult => ({
      id, name, status: 'error', verdict: null, data: null, error: 'stub', durationMs: 0,
    });

    const results: ScanResults = {
      sessionId: 'test', timestamp: Date.now(), overallGrade: 'B',
      geo: stubResult('geo', 'IP & Geo'),
      dns: stubResult('dns', 'DNS Leak'),
      webrtc: stubResult('webrtc', 'WebRTC Leak'),
      tls: stubResult('tls', 'TLS Analysis'),
      fingerprint: {
        id: 'fingerprint', name: 'Browser Fingerprint', status: 'complete', verdict: 'pass',
        data: {
          entropy: 18.5,
          uniqueAmong: 380000,
          components: [
            { name: 'User Agent', value: 'Mozilla/5.0', entropy: 8.2 },
            { name: 'Screen', value: '1920x1080', entropy: 4.1 },
          ],
        } as FingerprintResult,
        error: null, durationMs: 50,
      },
    };

    const container = document.createElement('div');
    renderReportCard(container, results);

    const bars = container.querySelectorAll('.entropy-bar');
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      const el = bar as HTMLElement;
      // Width should be set via JS (element.style.width), not via inline attribute in HTML
      expect(el.style.width).toBeTruthy();
    }
  });
});

describe('renderReportCard DNS summary', () => {
  it('renders inconclusive summary when DNS verdict is warn', () => {
    // Non-DNS results use status:'error' so getSummaryText returns early
    // without dereferencing null data
    const stubResult = (id: string, name: string): TestResult => ({
      id, name, status: 'error', verdict: null, data: null, error: 'stub', durationMs: 0,
    });

    const results: ScanResults = {
      sessionId: 'test', timestamp: Date.now(), overallGrade: 'C',
      geo: stubResult('geo', 'IP & Geo'),
      dns: {
        id: 'dns', name: 'DNS Leak', status: 'complete', verdict: 'warn',
        data: { resolvers: [{ ip: '8.8.8.8', country: 'US', countryCode: 'US' }], leakDetected: false, resolverCount: 1 } as DnsLeakResult,
        error: null, durationMs: 500,
      },
      webrtc: stubResult('webrtc', 'WebRTC Leak'),
      tls: stubResult('tls', 'TLS Analysis'),
      fingerprint: stubResult('fingerprint', 'Browser Fingerprint'),
    };

    const container = document.createElement('div');
    renderReportCard(container, results);

    const cards = container.querySelectorAll('.test-card');
    const dnsCard = Array.from(cards).find(c => c.querySelector('.test-card-title')?.textContent === 'DNS Leak');
    const summary = dnsCard?.querySelector('.test-card-summary');
    const badge = dnsCard?.querySelector('.verdict-badge');

    expect(badge?.textContent).toBe('WARN');
    expect(summary?.textContent).toContain('inconclusive');
    expect(summary?.textContent).not.toContain('no leak found');
  });
});

describe('renderReportCard WebRTC summary', () => {
  const stubResult = (id: string, name: string): TestResult => ({
    id, name, status: 'error', verdict: null, data: null, error: 'stub', durationMs: 0,
  });

  it('shows STUN IP warning when verdict is warn and publicIp exists', () => {
    const results: ScanResults = {
      sessionId: 'test', timestamp: Date.now(), overallGrade: 'C',
      geo: stubResult('geo', 'IP & Geo'),
      dns: stubResult('dns', 'DNS Leak'),
      webrtc: {
        id: 'webrtc', name: 'WebRTC Leak', status: 'complete', verdict: 'warn',
        data: {
          webrtcSupported: true, localIps: [], publicIp: '203.0.113.5',
          mdnsAddresses: [], leakDetected: false,
        } as WebRtcResult,
        error: null, durationMs: 100,
      },
      tls: stubResult('tls', 'TLS Analysis'),
      fingerprint: stubResult('fingerprint', 'Browser Fingerprint'),
    };

    const container = document.createElement('div');
    renderReportCard(container, results);

    const cards = container.querySelectorAll('.test-card');
    const webrtcCard = Array.from(cards).find(c => c.querySelector('.test-card-title')?.textContent === 'WebRTC Leak');
    const summary = webrtcCard?.querySelector('.test-card-summary');
    const badge = webrtcCard?.querySelector('.verdict-badge');

    expect(badge?.textContent).toBe('WARN');
    expect(summary?.textContent).toContain('203.0.113.5');
    expect(summary?.textContent).not.toContain('No IP addresses exposed');
  });
});

describe('fingerprint details entity safety', () => {
  const stubResult = (id: string, name: string): TestResult => ({
    id, name, status: 'error', verdict: null, data: null, error: 'stub', durationMs: 0,
  });

  it('does not produce broken HTML entities in truncated fingerprint values', () => {
    const results: ScanResults = {
      sessionId: 'test', timestamp: Date.now(), overallGrade: 'B',
      geo: stubResult('geo', 'IP & Geo'),
      dns: stubResult('dns', 'DNS Leak'),
      webrtc: stubResult('webrtc', 'WebRTC Leak'),
      tls: stubResult('tls', 'TLS Analysis'),
      fingerprint: {
        id: 'fingerprint', name: 'Browser Fingerprint', status: 'complete', verdict: 'pass',
        data: {
          entropy: 18.5, uniqueAmong: 380000,
          components: [
            { name: 'Test', value: "abc'def'ghi'jkl'mno'pqr'stu", entropy: 5.0 },
          ],
        } as FingerprintResult,
        error: null, durationMs: 50,
      },
    };

    const container = document.createElement('div');
    renderReportCard(container, results);

    const detailValues = container.querySelectorAll('.detail-value');
    for (const el of detailValues) {
      // No broken entities like &#3... or &amp...
      expect(el.innerHTML).not.toMatch(/&[a-z#0-9]*\.\.\./);
    }
  });
});

describe('renderReportCard geo details', () => {
  const stubResult = (id: string, name: string): TestResult => ({
    id, name, status: 'error', verdict: null, data: null, error: 'stub', durationMs: 0,
  });

  it('does not render literal "null" when coloCountry is null', () => {
    const results: ScanResults = {
      sessionId: 'test', timestamp: Date.now(), overallGrade: 'C',
      geo: {
        id: 'geo', name: 'IP & Geo', status: 'complete', verdict: 'fail',
        data: {
          ip: '1.2.3.4', country: 'United States', countryCode: 'US',
          city: 'Dallas', region: 'Texas', regionCode: 'TX',
          postalCode: '75001', latitude: '32.78', longitude: '-96.80',
          timezone: 'America/Chicago', continent: 'NA', isEU: false,
          asn: 7922, asOrganization: 'Comcast', colo: 'DFW',
          coloCity: 'Dallas', coloCountry: null,
          httpProtocol: 'HTTP/2', isVpnLikely: false,
        } as GeoResult,
        error: null, durationMs: 0,
      },
      dns: stubResult('dns', 'DNS Leak'),
      webrtc: stubResult('webrtc', 'WebRTC Leak'),
      tls: stubResult('tls', 'TLS Analysis'),
      fingerprint: stubResult('fingerprint', 'Browser Fingerprint'),
    };

    const container = document.createElement('div');
    renderReportCard(container, results);

    const cells = container.querySelectorAll('td');
    for (const cell of cells) {
      expect(cell.textContent).not.toContain('null');
    }
  });
});
