import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App } from './app';

// Mock the runner module
vi.mock('../scanner/runner', () => ({
  runAllTests: vi.fn(async function*() {
    // Yield one progress then hang (never complete)
    yield { phase: 'test', testsComplete: 0, testsTotal: 5, currentTest: null, results: {} };
    // simulate a long-running scan
    await new Promise(() => {});
  }),
}));

// Mock renderProgress and renderReportCard to avoid DOM manipulation
vi.mock('./progress', () => ({ renderProgress: vi.fn() }));
vi.mock('./report', () => ({
  renderReportCard: vi.fn(),
  renderGradeGauge: vi.fn(() => document.createElement('div')),
}));
vi.mock('./share', () => ({
  shareResults: vi.fn(),
  checkForSharedResults: vi.fn(() => null),
}));

function setupDOM() {
  document.body.innerHTML = `
    <button id="btn-scan"></button>
    <button id="btn-rescan"></button>
    <button id="btn-share"></button>
    <button id="btn-cancel"></button>
    <section id="state-idle" class="state"></section>
    <section id="state-scanning" class="state hidden"></section>
    <section id="state-results" class="state hidden"></section>
    <div id="progress-container"></div>
    <div id="report-container"></div>
  `;
}

beforeEach(() => {
  setupDOM();
});

describe('App state machine', () => {
  it('ignores startScan() when already scanning', async () => {
    const app = new App();
    app.init();

    // First call starts scan
    const p1 = app.startScan();
    expect(app.getState()).toBe('scanning');

    // Second call should be a no-op
    const p2 = app.startScan();
    // state should still be scanning, not a new scan
    expect(app.getState()).toBe('scanning');
  });

  it('allows startScan() after cancel returns to idle', () => {
    const app = new App();
    app.init();

    app.startScan();
    expect(app.getState()).toBe('scanning');

    app.cancelScan();
    expect(app.getState()).toBe('idle');
  });

  it('transitions to error state on network error', async () => {
    // Re-mock runner to throw TypeError
    const { runAllTests } = await import('../scanner/runner');
    vi.mocked(runAllTests).mockImplementation(async function*() {
      throw new TypeError('fetch failed');
    });

    const app = new App();
    app.init();
    await app.startScan();

    expect(app.getState()).toBe('error');
  });

  it('allows retry from error state without page reload', async () => {
    const { runAllTests } = await import('../scanner/runner');
    vi.mocked(runAllTests).mockImplementation(async function*() {
      throw new TypeError('fetch failed');
    });

    const app = new App();
    app.init();
    await app.startScan();
    expect(app.getState()).toBe('error');

    // Re-mock to a normal hanging scan so the retry starts
    vi.mocked(runAllTests).mockImplementation(async function*() {
      yield { phase: 'test', testsComplete: 0, testsTotal: 5, currentTest: null, results: {} };
      await new Promise(() => {});
    });

    // Should be able to scan again from error state
    app.startScan();
    expect(app.getState()).toBe('scanning');
    // Error UI should be cleaned up
    expect(document.getElementById('progress-container')!.innerHTML).toBe('');
  });

  it('Try Again button retries scan without page reload', async () => {
    const { runAllTests } = await import('../scanner/runner');
    vi.mocked(runAllTests).mockImplementation(async function*() {
      throw new TypeError('fetch failed');
    });

    const app = new App();
    app.init();
    await app.startScan();
    expect(app.getState()).toBe('error');

    // Re-mock to normal scan
    vi.mocked(runAllTests).mockImplementation(async function*() {
      yield { phase: 'test', testsComplete: 0, testsTotal: 5, currentTest: null, results: {} };
      await new Promise(() => {});
    });

    // Click the retry button rendered in the error UI
    const retryBtn = document.querySelector('.error-retry') as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    retryBtn.click();

    // Give the async startScan a tick to begin
    await new Promise(r => setTimeout(r, 0));
    expect(app.getState()).toBe('scanning');
  });
});

describe('setState timeout tracking', () => {
  it('cancels pending transition timeouts on rapid state changes', () => {
    vi.useFakeTimers();
    const app = new App();
    app.init();

    // idle -> scanning (starts a 350ms timeout to hide idle section)
    app.startScan();
    // scanning -> idle before 350ms fires
    app.cancelScan();

    // Advance past the timeout
    vi.advanceTimersByTime(400);

    // idle section should be visible, scanning should be hidden
    expect(document.getElementById('state-idle')!.classList.contains('hidden')).toBe(false);

    vi.useRealTimers();
  });

  it('clears stale fade-out class when cancel happens within transition window', () => {
    vi.useFakeTimers();
    const app = new App();
    app.init();

    // idle -> scanning: adds fade-out to #state-idle
    app.startScan();
    // Cancel immediately (within 350ms) before transition timer fires
    app.cancelScan();

    const idleSection = document.getElementById('state-idle')!;
    // fade-out must NOT persist — it carries pointer-events: none in CSS
    expect(idleSection.classList.contains('fade-out')).toBe(false);

    // Even after advancing past the transition time, no stale fade-out
    vi.advanceTimersByTime(400);
    expect(idleSection.classList.contains('fade-out')).toBe(false);

    vi.useRealTimers();
  });

  it('hides idle section when scan completes before fade transition finishes', async () => {
    vi.useFakeTimers();

    const { runAllTests } = await import('../scanner/runner');
    vi.mocked(runAllTests).mockImplementation(async function*() {
      yield {
        phase: 'done', testsComplete: 5, testsTotal: 5, currentTest: null,
        results: {
          sessionId: 'x', timestamp: Date.now(), overallGrade: 'A',
          dns: { id: 'dns', name: 'DNS', status: 'complete', verdict: 'pass', data: { resolvers: [], leakDetected: false, resolverCount: 0 }, error: null, durationMs: 0 },
          webrtc: { id: 'webrtc', name: 'WebRTC', status: 'complete', verdict: 'pass', data: { webrtcSupported: false, localIps: [], publicIp: null, mdnsAddresses: [], leakDetected: false }, error: null, durationMs: 0 },
          tls: { id: 'tls', name: 'TLS', status: 'complete', verdict: 'pass', data: null, error: null, durationMs: 0 },
          fingerprint: { id: 'fingerprint', name: 'FP', status: 'complete', verdict: 'pass', data: null, error: null, durationMs: 0 },
          geo: { id: 'geo', name: 'Geo', status: 'complete', verdict: 'pass', data: null, error: null, durationMs: 0 },
        },
      };
    });

    const app = new App();
    app.init();
    await app.startScan();

    const idleSection = document.getElementById('state-idle')!;
    expect(idleSection.classList.contains('hidden')).toBe(true);

    vi.useRealTimers();
  });
});

describe('Shared results view (Bug 1)', () => {
  it('registers button handlers even when showing shared results', async () => {
    const { checkForSharedResults } = await import('./share');
    vi.mocked(checkForSharedResults).mockReturnValue({
      v: 1, t: Date.now(), g: 'B',
      d: { v: 'pass', s: 'ok' }, w: { v: 'pass', s: 'ok' },
      l: { v: 'pass', s: 'ok' }, f: { v: 'pass', s: 'ok' },
      i: { v: 'pass', s: 'ok' },
    });
    const app = new App();
    app.init();

    // btn-rescan should work even in shared view
    document.getElementById('btn-rescan')!.click();
    expect(app.getState()).toBe('idle');
  });
});

describe('Cancel button cleanup (Bug 4)', () => {
  it('removes cancel listener when scan completes without cancel', async () => {
    const { runAllTests } = await import('../scanner/runner');
    vi.mocked(runAllTests).mockImplementation(async function*() {
      yield {
        phase: 'done', testsComplete: 5, testsTotal: 5, currentTest: null,
        results: { sessionId: 'x', timestamp: Date.now(), overallGrade: 'A',
          dns: { id: 'dns', name: 'DNS', status: 'complete', verdict: 'pass', data: { resolvers: [], leakDetected: false, resolverCount: 0 }, error: null, durationMs: 0 },
          webrtc: { id: 'webrtc', name: 'WebRTC', status: 'complete', verdict: 'pass', data: { webrtcSupported: false, localIps: [], publicIp: null, mdnsAddresses: [], leakDetected: false }, error: null, durationMs: 0 },
          tls: { id: 'tls', name: 'TLS', status: 'complete', verdict: 'pass', data: null, error: null, durationMs: 0 },
          fingerprint: { id: 'fingerprint', name: 'FP', status: 'complete', verdict: 'pass', data: null, error: null, durationMs: 0 },
          geo: { id: 'geo', name: 'Geo', status: 'complete', verdict: 'pass', data: null, error: null, durationMs: 0 },
        },
      };
    });
    const app = new App();
    app.init();

    const cancelBtn = document.getElementById('btn-cancel')!;
    const removeSpy = vi.spyOn(cancelBtn, 'removeEventListener');

    await app.startScan();
    expect(removeSpy).toHaveBeenCalled();
  });
});

describe('Reset cleanup (Bug 7)', () => {
  it('clears progress-container on reset', () => {
    const app = new App();
    app.init();
    document.getElementById('progress-container')!.innerHTML = '<div class="radar">stale</div>';
    app.reset();
    expect(document.getElementById('progress-container')!.innerHTML).toBe('');
  });
});

describe('Shared results transition (Bug 8)', () => {
  it('shows results immediately without 350ms fade on shared URL load', async () => {
    vi.useFakeTimers();
    const { checkForSharedResults } = await import('./share');
    vi.mocked(checkForSharedResults).mockReturnValue({
      v: 1, t: Date.now(), g: 'A',
      d: { v: 'pass', s: 'ok' }, w: { v: 'pass', s: 'ok' },
      l: { v: 'pass', s: 'ok' }, f: { v: 'pass', s: 'ok' },
      i: { v: 'pass', s: 'ok' },
    });
    const app = new App();
    app.init();

    const resultsSection = document.getElementById('state-results')!;
    const idleSection = document.getElementById('state-idle')!;

    // Results should be visible immediately, not after 350ms
    expect(resultsSection.classList.contains('hidden')).toBe(false);
    expect(idleSection.classList.contains('hidden')).toBe(true);

    vi.useRealTimers();
  });
});

describe('Cancel-rescan race condition', () => {
  it('cancel listener survives when old scan finally runs after new scan starts', async () => {
    const { runAllTests } = await import('../scanner/runner');

    // Mock that responds to abort so scanA's promise actually resolves
    vi.mocked(runAllTests).mockImplementation(async function*(signal?: AbortSignal) {
      yield { phase: 'test', testsComplete: 0, testsTotal: 5, currentTest: null, results: {} };
      await new Promise<void>((_, reject) => {
        if (signal?.aborted) { reject(signal.reason); return; }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    const app = new App();
    app.init();

    // Scan A starts
    const scanA = app.startScan();
    expect(app.getState()).toBe('scanning');

    // Cancel Scan A — state goes to idle synchronously
    app.cancelScan();
    expect(app.getState()).toBe('idle');

    // Re-mock for Scan B (hangs forever, we won't cancel it in this test)
    vi.mocked(runAllTests).mockImplementation(async function*() {
      yield { phase: 'test', testsComplete: 0, testsTotal: 5, currentTest: null, results: {} };
      await new Promise(() => {});
    });

    // Scan B starts before Scan A's finally has run
    app.startScan();
    expect(app.getState()).toBe('scanning');

    // Let Scan A's catch/finally settle
    await scanA;

    // Scan B's cancel listener should still work
    const cancelBtn = document.getElementById('btn-cancel')!;
    cancelBtn.click();
    expect(app.getState()).toBe('idle');
  });
});

describe('reset() history handling', () => {
  it('uses replaceState instead of pushing a new history entry', () => {
    const replaceSpy = vi.spyOn(history, 'replaceState');
    const app = new App();
    app.init();
    app.reset();

    expect(replaceSpy).toHaveBeenCalledWith(null, '', window.location.pathname);
    replaceSpy.mockRestore();
  });
});
