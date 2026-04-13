import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pollDnsResults } from './dns';

beforeEach(() => {
  vi.stubGlobal('performance', { now: vi.fn(() => 1000) });
});

describe('pollDnsResults', () => {
  it('returns error result when response is not ok (HTTP 500)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, status: 500,
    })));

    const result = await pollDnsResults('', 'test-id', 1);
    expect(result.status).toBe('error');
    expect(result.error).toContain('HTTP 500');
  });

  it('returns complete result on successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        status: 'complete',
        resolvers: [{ ip: '8.8.8.8', country: 'US', countryCode: 'US' }],
        message: null,
      }),
    })));

    const result = await pollDnsResults('', 'test-id', 1);
    expect(result.status).toBe('complete');
    expect(result.data!.resolvers).toHaveLength(1);
    expect(result.data!.resolverCount).toBe(1);
  });

  it('returns error on status: error response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        status: 'error',
        resolvers: [],
        message: 'bash.ws down',
      }),
    })));

    const result = await pollDnsResults('', 'test-id', 1);
    expect(result.status).toBe('error');
    expect(result.error).toBe('bash.ws down');
  });

  it('retries on pending then succeeds', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'pending', resolvers: [], message: null }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          status: 'complete',
          resolvers: [{ ip: '1.1.1.1', country: 'US', countryCode: 'US' }],
          message: null,
        }),
      });
    }));

    const result = await pollDnsResults('', 'test-id', 3);
    expect(result.status).toBe('complete');
    expect(callCount).toBe(2);
  });
});
