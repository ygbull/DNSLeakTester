import type { TestResult, DnsLeakResult } from './types';
import type { DnsStartResponse, DnsCheckResponse } from '../../worker/types';
import { abortableSleep } from '../utils/format';

export async function initDnsTest(apiBase: string, signal?: AbortSignal): Promise<DnsStartResponse> {
  const resp = await fetch(`${apiBase}/api/dns/start`, { method: 'POST', signal });
  if (!resp.ok) throw new Error(`DNS init failed: ${resp.status}`);
  return resp.json();
}

export async function triggerDnsProbes(hostnames: string[], delayMs: number, signal?: AbortSignal): Promise<void> {
  for (const hostname of hostnames) {
    signal?.throwIfAborted();
    const img = new Image();
    img.src = `https://${hostname}`;
    await abortableSleep(delayMs, signal);
  }
}

export async function pollDnsResults(
  apiBase: string,
  testId: string,
  maxAttempts = 3,
  signal?: AbortSignal
): Promise<TestResult<DnsLeakResult>> {
  const start = performance.now();

  for (let i = 0; i < maxAttempts; i++) {
    const resp = await fetch(`${apiBase}/api/dns/check/${testId}`, { signal });
    if (!resp.ok) {
      return {
        id: 'dns', name: 'DNS Leak', status: 'error',
        verdict: null, data: null,
        error: `DNS check failed (HTTP ${resp.status})`,
        durationMs: Math.round(performance.now() - start),
      };
    }
    const data: DnsCheckResponse = await resp.json();

    if (data.status === 'complete') {
      return {
        id: 'dns', name: 'DNS Leak', status: 'complete',
        verdict: null,
        data: { resolvers: data.resolvers, leakDetected: false, resolverCount: data.resolvers.length },
        error: null, durationMs: Math.round(performance.now() - start),
      };
    }

    if (data.status === 'error') {
      return {
        id: 'dns', name: 'DNS Leak', status: 'error',
        verdict: null, data: null, error: data.message ?? 'DNS test failed',
        durationMs: Math.round(performance.now() - start),
      };
    }

    // pending — wait before next poll
    await abortableSleep(2000, signal);
  }

  return {
    id: 'dns', name: 'DNS Leak', status: 'error',
    verdict: null, data: null,
    error: 'DNS leak test timed out — try again',
    durationMs: Math.round(performance.now() - start),
  };
}
