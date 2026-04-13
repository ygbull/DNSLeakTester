import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BashWsBackend } from './dns-backend';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BashWsBackend', () => {
  it('startTest returns probe config on success', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('test123'),
    })));

    const backend = new BashWsBackend();
    const result = await backend.startTest();
    expect(result.backendTestId).toBe('test123');
    expect(result.probeHostnames).toHaveLength(10);
    expect(result.probeHostnames[0]).toBe('1.test123.bash.ws');
  });

  it('startTest passes AbortSignal to fetch', async () => {
    const mockFetch = vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('abc'),
    }));
    vi.stubGlobal('fetch', mockFetch);

    const backend = new BashWsBackend();
    await backend.startTest();

    // Verify fetch was called with a signal
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1]).toHaveProperty('signal');
    expect(callArgs[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('getResults passes AbortSignal to fetch', async () => {
    const mockFetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve([{ ip: '8.8.8.8', country_name: 'US', country: 'US', type: 'dns' }]),
    }));
    vi.stubGlobal('fetch', mockFetch);

    const backend = new BashWsBackend();
    await backend.getResults('test123');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1]).toHaveProperty('signal');
    expect(callArgs[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('returns ready: true when only conclusion entries exist (zero resolvers)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve([
        { type: 'conclusion', ip: false },
      ]),
    })));

    const backend = new BashWsBackend();
    const result = await backend.getResults('test123');
    expect(result.ready).toBe(true);
    expect(result.resolvers).toHaveLength(0);
  });

  it('getResults returns resolvers from bash.ws response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve([
        { ip: '8.8.8.8', country_name: 'United States', country: 'US', type: 'dns' },
        { ip: '8.8.4.4', country_name: 'United States', country: 'US', type: 'dns' },
        { type: 'conclusion', ip: null },
      ]),
    })));

    const backend = new BashWsBackend();
    const result = await backend.getResults('test123');
    expect(result.ready).toBe(true);
    expect(result.resolvers).toHaveLength(2);
    expect(result.resolvers[0].ip).toBe('8.8.8.8');
  });

  it('getResults throws on HTTP error from bash.ws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 500,
    })));
    const backend = new BashWsBackend();
    await expect(backend.getResults('test123')).rejects.toThrow(/HTTP 500/);
  });

  it('getResults returns ready false for empty array (not an error)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    })));
    const backend = new BashWsBackend();
    const result = await backend.getResults('test123');
    expect(result.ready).toBe(false);
    expect(result.resolvers).toHaveLength(0);
  });
});

describe('BashWsBackend ID validation', () => {
  it('rejects bash.ws IDs with special characters', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, text: () => Promise.resolve('evil/../../etc'),
    })));
    const backend = new BashWsBackend();
    await expect(backend.startTest()).rejects.toThrow(/invalid/i);
  });

  it('rejects bash.ws IDs with newlines', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, text: () => Promise.resolve("test123\nHost: evil"),
    })));
    const backend = new BashWsBackend();
    await expect(backend.startTest()).rejects.toThrow(/invalid/i);
  });

  it('accepts valid alphanumeric bash.ws IDs', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, text: () => Promise.resolve('abc123XYZ'),
    })));
    const backend = new BashWsBackend();
    const result = await backend.startTest();
    expect(result.backendTestId).toBe('abc123XYZ');
  });
});
