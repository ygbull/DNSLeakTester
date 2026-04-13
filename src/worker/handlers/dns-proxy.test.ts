import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Env } from '../types';

const { mockStartTest, mockGetResults } = vi.hoisted(() => ({
  mockStartTest: vi.fn(),
  mockGetResults: vi.fn(),
}));

vi.mock('../services/dns-backend', () => ({
  BashWsBackend: vi.fn().mockImplementation(() => ({
    startTest: mockStartTest,
    getResults: mockGetResults,
  })),
}));

import { handleDnsStart, handleDnsCheck } from './dns-proxy';

function makeEnv(): Env {
  return {
    LEAK_STORE: { put: vi.fn(), get: vi.fn() } as unknown as KVNamespace,
    ASSETS: {} as Fetcher,
    ENVIRONMENT: 'test',
    CORS_ORIGIN: 'https://example.com',
  };
}

describe('handleDnsStart', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns { error: string } shape on failure, not DnsCheckResponse', async () => {
    mockStartTest.mockRejectedValue(new Error('bash.ws unreachable'));

    const resp = await handleDnsStart(
      new Request('https://x/api/dns/start', { method: 'POST' }), makeEnv()
    );
    expect(resp.status).toBe(502);
    const body = await resp.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
    expect(body).not.toHaveProperty('resolvers');
    expect(body).not.toHaveProperty('status');
  });

  it('does not expose bash.ws error details to the client', async () => {
    mockStartTest.mockRejectedValue(new Error('connect ECONNREFUSED 1.2.3.4:443'));

    const resp = await handleDnsStart(
      new Request('https://x/api/dns/start', { method: 'POST' }), makeEnv()
    );
    const body = await resp.json() as Record<string, unknown>;
    expect(resp.status).toBe(502);
    expect(String(body.error)).not.toContain('ECONNREFUSED');
    expect(String(body.error)).not.toContain('1.2.3.4');
  });
});

describe('handleDnsCheck', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns 404 for missing session', async () => {
    const env = makeEnv();
    (env.LEAK_STORE.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const resp = await handleDnsCheck('missing-id', env);
    expect(resp.status).toBe(404);
  });

  it('does not expose backend error details in check response', async () => {
    const env = makeEnv();
    (env.LEAK_STORE.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ bashWsId: 'abc123', status: 'probing', startedAt: Date.now() })
    );
    mockGetResults.mockRejectedValue(new Error('unexpected token < in JSON at position 0'));

    const resp = await handleDnsCheck('test-id', env);
    const body = await resp.json() as Record<string, unknown>;
    expect(resp.status).toBe(502);
    expect(String(body.message)).not.toContain('unexpected token');
  });
});
