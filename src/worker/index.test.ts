import { describe, it, expect, vi } from 'vitest';

// Mock analyze handler to throw internal error
vi.mock('./handlers/analyze', () => ({
  handleAnalyze: vi.fn(() => { throw new Error('KV binding failed: Account xyz123'); }),
}));
vi.mock('./handlers/dns-proxy', () => ({
  handleDnsStart: vi.fn(),
  handleDnsCheck: vi.fn(),
}));

import worker from './index';
import type { Env } from './types';

const mockEnv = {
  CORS_ORIGIN: 'https://example.com',
  ASSETS: { fetch: vi.fn(() => new Response('static', { headers: { 'content-type': 'text/plain' } })) },
} as unknown as Env;

describe('CORS headers', () => {
  it('does not default to wildcard when CORS_ORIGIN is missing', async () => {
    const env = {
      ASSETS: { fetch: vi.fn(() => new Response('ok')) },
    } as unknown as Env;
    const resp = await worker.fetch(new Request('https://x/api/analyze'), env);
    expect(resp.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });

  it('uses configured CORS_ORIGIN value', async () => {
    const env = {
      CORS_ORIGIN: 'https://leak.haijieqin.com',
      ASSETS: { fetch: vi.fn(() => new Response('ok')) },
    } as unknown as Env;
    const resp = await worker.fetch(new Request('https://x/api/analyze'), env);
    expect(resp.headers.get('Access-Control-Allow-Origin')).toBe('https://leak.haijieqin.com');
  });
});

describe('Worker error handling', () => {
  it('does not leak internal error messages to clients', async () => {
    const req = new Request('https://example.com/api/analyze');
    const resp = await worker.fetch(req, mockEnv);

    expect(resp.status).toBe(500);
    const body = await resp.json();

    // Must NOT contain internal details
    expect(JSON.stringify(body)).not.toContain('KV binding failed');
    expect(JSON.stringify(body)).not.toContain('xyz123');
    expect(body.error).toBe('Internal error');
    // Should not have a message field
    expect(body.message).toBeUndefined();
  });
});

describe('DNS check testId validation', () => {
  it('returns 400 for non-UUID testId', async () => {
    const req = new Request('https://x/api/dns/check/not-a-uuid');
    const resp = await worker.fetch(req, mockEnv);
    expect(resp.status).toBe(400);
  });

  it('returns 400 for empty testId', async () => {
    const req = new Request('https://x/api/dns/check/');
    const resp = await worker.fetch(req, mockEnv);
    expect(resp.status).toBe(400);
  });

  it('passes valid UUID testId to handler', async () => {
    const { handleDnsCheck } = await import('./handlers/dns-proxy');
    vi.mocked(handleDnsCheck).mockResolvedValue(
      new Response(JSON.stringify({ status: 'complete', resolvers: [] }))
    );

    const req = new Request('https://x/api/dns/check/550e8400-e29b-41d4-a716-446655440000');
    await worker.fetch(req, mockEnv);
    expect(vi.mocked(handleDnsCheck)).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      expect.anything()
    );
  });
});
