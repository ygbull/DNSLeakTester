import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encodeResults, decodeResults, shareResults } from './share';
import type { ScanResults, TestResult, DnsLeakResult, WebRtcResult, TlsResult, FingerprintResult, GeoResult } from '../scanner/types';

function makeScanResults(): ScanResults {
  return {
    sessionId: 'abc-123',
    timestamp: 1711234567890,
    overallGrade: 'B',
    dns: {
      id: 'dns', name: 'DNS Leak', status: 'complete', verdict: 'pass',
      data: { resolvers: [{ ip: '8.8.8.8', country: 'United States', countryCode: 'US' }], leakDetected: false, resolverCount: 1 } as DnsLeakResult,
      error: null, durationMs: 500,
    },
    webrtc: {
      id: 'webrtc', name: 'WebRTC Leak', status: 'complete', verdict: 'pass',
      data: { webrtcSupported: true, localIps: [], publicIp: null, mdnsAddresses: ['abc.local'], leakDetected: false } as WebRtcResult,
      error: null, durationMs: 200,
    },
    tls: {
      id: 'tls', name: 'TLS Analysis', status: 'complete', verdict: 'warn',
      data: { version: 'TLSv1.3', cipher: 'AES-128', protocol: 'HTTP/2', ciphersSha1: 'abc', extensionsSha1: 'def', helloLength: '512', profileId: 'xyz', knownProfile: null, commonality: 'unknown' } as TlsResult,
      error: null, durationMs: 0,
    },
    fingerprint: {
      id: 'fingerprint', name: 'Browser Fingerprint', status: 'complete', verdict: 'warn',
      data: { entropy: 28.5, components: [], uniqueAmong: 379625062 } as FingerprintResult,
      error: null, durationMs: 100,
    },
    geo: {
      id: 'geo', name: 'IP & Geo', status: 'complete', verdict: 'pass',
      data: { ip: '1.2.3.4', country: 'US', countryCode: 'US', city: 'Dallas', region: 'TX', regionCode: 'TX', postalCode: '75001', latitude: '32.7', longitude: '-96.8', timezone: 'America/Chicago', continent: 'NA', isEU: false, asn: 13335, asOrganization: 'Cloudflare', colo: 'DFW', coloCity: 'Dallas', coloCountry: 'US', httpProtocol: 'HTTP/2', isVpnLikely: true } as GeoResult,
      error: null, durationMs: 0,
    },
  };
}

describe('share encoding/decoding', () => {
  it('round-trips encode/decode', () => {
    const results = makeScanResults();
    const encoded = encodeResults(results);
    const decoded = decodeResults(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.v).toBe(1);
    expect(decoded!.g).toBe('B');
    expect(decoded!.t).toBe(1711234567890);
    expect(decoded!.d.v).toBe('pass');
    expect(decoded!.w.v).toBe('pass');
    expect(decoded!.l.v).toBe('warn');
    expect(decoded!.f.v).toBe('warn');
    expect(decoded!.i.v).toBe('pass');
  });

  it('strips private data from summaries', () => {
    const results = makeScanResults();
    const encoded = encodeResults(results);
    const decoded = decodeResults(encoded);

    // No IPs in shared summaries
    expect(decoded!.d.s).not.toContain('8.8.8.8');
    expect(decoded!.i.s).not.toContain('1.2.3.4');
    expect(decoded!.i.s).not.toContain('Dallas');
  });

  it('returns null for corrupted data', () => {
    expect(decodeResults('not-valid-base64!!!')).toBeNull();
    expect(decodeResults('')).toBeNull();
  });

  it('returns null for wrong version', () => {
    const json = JSON.stringify({ v: 2, t: 0, g: 'A', d: { v: 'pass', s: '' }, w: { v: 'pass', s: '' }, l: { v: 'pass', s: '' }, f: { v: 'pass', s: '' }, i: { v: 'pass', s: '' } });
    const encoded = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeResults(encoded)).toBeNull();
  });

  it('rejects invalid verdict values', () => {
    const json = JSON.stringify({ v: 1, t: 0, g: 'A', d: { v: 'hacked', s: 'x' }, w: { v: 'pass', s: '' }, l: { v: 'pass', s: '' }, f: { v: 'pass', s: '' }, i: { v: 'pass', s: '' } });
    const encoded = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeResults(encoded)).toBeNull();
  });

  it('rejects strings exceeding length cap', () => {
    const longStr = 'x'.repeat(201);
    const json = JSON.stringify({ v: 1, t: 0, g: 'A', d: { v: 'pass', s: longStr }, w: { v: 'pass', s: '' }, l: { v: 'pass', s: '' }, f: { v: 'pass', s: '' }, i: { v: 'pass', s: '' } });
    const encoded = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeResults(encoded)).toBeNull();
  });

  it('rejects invalid grade values', () => {
    const json = JSON.stringify({ v: 1, t: 0, g: 'X', d: { v: 'pass', s: '' }, w: { v: 'pass', s: '' }, l: { v: 'pass', s: '' }, f: { v: 'pass', s: '' }, i: { v: 'pass', s: '' } });
    const encoded = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeResults(encoded)).toBeNull();
  });

  it('rejects XSS payload in grade field', () => {
    const json = JSON.stringify({ v: 1, t: 0, g: '</text></svg><img src=x onerror=alert(1)>', d: { v: 'pass', s: '' }, w: { v: 'pass', s: '' }, l: { v: 'pass', s: '' }, f: { v: 'pass', s: '' }, i: { v: 'pass', s: '' } });
    const encoded = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeResults(encoded)).toBeNull();
  });

  it('accepts all valid grade values A through F', () => {
    for (const grade of ['A', 'B', 'C', 'D', 'F']) {
      const json = JSON.stringify({ v: 1, t: 1000, g: grade, d: { v: 'pass', s: 'ok' }, w: { v: 'pass', s: 'ok' }, l: { v: 'pass', s: 'ok' }, f: { v: 'pass', s: 'ok' }, i: { v: 'pass', s: 'ok' } });
      const encoded = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      expect(decodeResults(encoded)).not.toBeNull();
    }
  });

  it('handles unicode content (city names like São Paulo)', () => {
    const results = makeScanResults();
    (results.geo.data as GeoResult).city = 'São Paulo';
    const encoded = encodeResults(results);
    const decoded = decodeResults(encoded);
    expect(decoded).not.toBeNull();
    // Unicode didn't break the encoding
    expect(decoded!.v).toBe(1);
  });

  it('encodes dns verdict as warn (not error) when verdict is explicitly warn', () => {
    const results = makeScanResults();
    results.dns.verdict = 'warn';
    results.geo.verdict = null;
    results.geo.status = 'error';
    results.geo.data = null;
    results.geo.error = 'Analyze failed: 500';

    const encoded = encodeResults(results);
    const decoded = decodeResults(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.d.v).toBe('warn');    // DNS encoded as 'warn', not 'error'
    expect(decoded!.i.v).toBe('error');   // Geo encoded as 'error' (null → 'error')
  });

  it('encodes dns summary as inconclusive when verdict is warn', () => {
    const results = makeScanResults();
    results.dns.verdict = 'warn';

    const encoded = encodeResults(results);
    const decoded = decodeResults(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.d.s).toContain('inconclusive');
    expect(decoded!.d.s).not.toContain('no leak');
  });
});

describe('shareResults clipboard handling', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="btn-share">Share Results</button>';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('falls back to prompt when clipboard.writeText rejects', async () => {
    const mockPrompt = vi.fn();
    vi.stubGlobal('prompt', mockPrompt);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new DOMException('denied')) },
      writable: true, configurable: true,
    });

    shareResults(makeScanResults());
    await new Promise(r => setTimeout(r, 0));
    expect(mockPrompt).toHaveBeenCalledWith('Copy this link:', expect.stringContaining('#r='));
  });

  it('shows copied feedback on clipboard success', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true, configurable: true,
    });

    shareResults(makeScanResults());
    await new Promise(r => setTimeout(r, 0));
    expect(document.getElementById('btn-share')!.textContent).toBe('Copied!');
  });

  it('restores button text after timeout', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true, configurable: true,
    });

    shareResults(makeScanResults());
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById('btn-share')!.textContent).toBe('Copied!');

    await vi.advanceTimersByTimeAsync(2000);
    expect(document.getElementById('btn-share')!.textContent).toBe('Share Results');
    vi.useRealTimers();
  });

  it('restores button text correctly after rapid double-click', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true, configurable: true,
    });

    shareResults(makeScanResults());
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById('btn-share')!.textContent).toBe('Copied!');

    // Second click within 2s
    shareResults(makeScanResults());
    await vi.advanceTimersByTimeAsync(0);

    // After all timeouts expire, button should show original text
    await vi.advanceTimersByTimeAsync(2000);
    expect(document.getElementById('btn-share')!.textContent).toBe('Share Results');
    expect(document.getElementById('btn-share')!.classList.contains('copied')).toBe(false);
    vi.useRealTimers();
  });
});
