import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock browser-dependent modules before importing runner
vi.mock('./webrtc', () => ({
  runWebRtcTest: vi.fn().mockResolvedValue({
    webrtcSupported: true, localIps: [], publicIp: null, mdnsAddresses: [], leakDetected: false,
  }),
}));
vi.mock('./fingerprint', () => ({
  runFingerprintTest: vi.fn().mockResolvedValue({
    entropy: 15, components: [], uniqueAmong: 32768,
  }),
}));

import { runAllTests } from './runner';
import type { ScanResults } from './types';

describe('runAllTests: geo fails, DNS succeeds', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('Image', class { set src(_: string) {} });
    vi.stubGlobal('crypto', { randomUUID: () => 'test-session-id' });

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/analyze')) {
        return Promise.resolve({ ok: false, status: 500 });
      }
      if (url.includes('/api/dns/start')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            testId: 'test-123', probeCount: 1,
            probeHostnames: ['1.test.bash.ws'],
            delayBetweenProbesMs: 0, waitAfterProbesMs: 0,
          }),
        });
      }
      if (url.includes('/api/dns/check/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            status: 'complete',
            resolvers: [{ ip: '8.8.8.8', country: 'US', countryCode: 'US' }],
            message: null,
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets DNS verdict to warn (not null) when analyze endpoint fails', async () => {
    let finalResults: Partial<ScanResults> = {};

    for await (const progress of runAllTests()) {
      finalResults = progress.results;
    }

    // Geo should be errored (analyze returned 500)
    expect(finalResults.geo?.status).toBe('error');
    expect(finalResults.geo?.data).toBeNull();

    // DNS should be complete with explicit warn verdict (NOT null)
    expect(finalResults.dns?.status).toBe('complete');
    expect(finalResults.dns?.verdict).toBe('warn');
    expect(finalResults.dns?.data).not.toBeNull();
    expect(finalResults.dns?.data?.leakDetected).toBe(false);

    // Grade should be computed
    expect(finalResults.overallGrade).toBeDefined();
  });
});

describe('runAllTests: abort during analyze fetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, opts?: { signal?: AbortSignal }) => {
      return new Promise<never>((_, reject) => {
        const signal = opts?.signal;
        if (signal?.aborted) {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        }, { once: true });
      });
    }));
    vi.stubGlobal('Image', class { set src(_: string) {} });
    vi.stubGlobal('crypto', { randomUUID: () => 'test-session-id' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('propagates AbortError immediately without extra yields', async () => {
    const controller = new AbortController();
    const phases: string[] = [];

    // Pre-abort the signal so fetchAnalyzeData rejects immediately
    controller.abort();

    let caughtError: unknown = null;
    try {
      for await (const progress of runAllTests(controller.signal)) {
        phases.push(progress.phase);
      }
    } catch (e) {
      caughtError = e;
    }

    // Verify abort propagated as an error
    expect(caughtError).not.toBeNull();
    expect((caughtError as Error).name).toBe('AbortError');
    // Should NOT have a "Network analyzed" phase — abort should propagate immediately
    expect(phases).not.toContain('Network analyzed');
  });
});
