import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runWebRtcTest } from './webrtc';

// Mock RTCPeerConnection
let onicecandidate: ((event: { candidate: null | { candidate: string } }) => void) | null = null;
const mockClose = vi.fn();

class MockRTCPeerConnection {
  close = mockClose;
  set onicecandidate(handler: ((event: { candidate: null | { candidate: string } }) => void) | null) {
    onicecandidate = handler;
  }
  createDataChannel() {}
  createOffer() {
    return Promise.resolve({});
  }
  setLocalDescription() {
    return Promise.resolve();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  mockClose.mockClear();
  onicecandidate = null;
  vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('runWebRtcTest', () => {
  it('calls pc.close() exactly once when both null candidate and timeout fire', async () => {
    const promise = runWebRtcTest();

    // Flush microtasks so createOffer/setLocalDescription resolve
    await vi.advanceTimersByTimeAsync(0);

    // Fire null candidate (signals ICE gathering complete)
    onicecandidate!({ candidate: null });

    // Now advance past the 5s timeout
    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result.webrtcSupported).toBe(true);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('resolves correctly when only timeout fires', async () => {
    const promise = runWebRtcTest();
    await vi.advanceTimersByTimeAsync(0);

    // Don't fire any candidates, just let timeout expire
    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result.webrtcSupported).toBe(true);
    expect(result.leakDetected).toBe(false);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('returns webrtcSupported false when RTCPeerConnection is undefined', async () => {
    vi.stubGlobal('RTCPeerConnection', undefined);
    const result = await runWebRtcTest();
    expect(result.webrtcSupported).toBe(false);
    expect(result.localIps).toEqual([]);
  });

  it('rejects with AbortError when signal fires', async () => {
    const controller = new AbortController();
    const promise = runWebRtcTest(controller.signal);
    await vi.advanceTimersByTimeAsync(0);

    // Attach rejection handler before aborting to avoid unhandled rejection
    const assertion = expect(promise).rejects.toThrow();
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    await assertion;
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const promise = runWebRtcTest(controller.signal);
    await expect(promise).rejects.toThrow();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('resolves normally when ICE completes before abort', async () => {
    const controller = new AbortController();
    const promise = runWebRtcTest(controller.signal);
    await vi.advanceTimersByTimeAsync(0);

    // ICE completes normally
    onicecandidate!({ candidate: null });
    const result = await promise;
    expect(result.webrtcSupported).toBe(true);

    // Abort after completion — should not cause unhandled rejection
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('does not produce unhandled rejection when offer races with close', async () => {
    let rejectOffer: (reason: Error) => void;
    class SlowOfferPC extends MockRTCPeerConnection {
      createOffer() {
        return new Promise<Record<string, never>>((_, reject) => { rejectOffer = reject; });
      }
    }
    vi.stubGlobal('RTCPeerConnection', SlowOfferPC);

    const promise = runWebRtcTest();
    // Timeout fires, calls finish() -> pc.close()
    await vi.advanceTimersByTimeAsync(5000);

    // Now reject the stale offer (simulates race with pc.close)
    rejectOffer!(new Error('InvalidStateError'));
    await vi.advanceTimersByTimeAsync(0);

    // Should resolve without throwing
    const result = await promise;
    expect(result.webrtcSupported).toBe(true);
    expect(mockClose).toHaveBeenCalled();
  });

  it('detects mDNS addresses', async () => {
    const promise = runWebRtcTest();
    await vi.advanceTimersByTimeAsync(0);

    onicecandidate!({ candidate: { candidate: 'candidate:1 1 UDP 2130706431 abc-123.local 12345 typ host' } });
    onicecandidate!({ candidate: null });

    const result = await promise;
    expect(result.mdnsAddresses).toContain('abc-123.local');
    expect(result.leakDetected).toBe(false);
  });

  it('detects IPv4-mapped IPv6 192.168.x as private', async () => {
    const promise = runWebRtcTest();
    await vi.advanceTimersByTimeAsync(0);

    onicecandidate!({ candidate: { candidate: 'candidate:1 1 UDP 2130706431 ::ffff:192.168.1.1 12345 typ host' } });
    onicecandidate!({ candidate: null });

    const result = await promise;
    expect(result.localIps).toContain('::ffff:192.168.1.1');
    expect(result.leakDetected).toBe(true);
  });

  it('detects IPv4-mapped IPv6 10.x as private', async () => {
    const promise = runWebRtcTest();
    await vi.advanceTimersByTimeAsync(0);

    onicecandidate!({ candidate: { candidate: 'candidate:1 1 UDP 2130706431 ::ffff:10.0.0.1 12345 typ host' } });
    onicecandidate!({ candidate: null });

    const result = await promise;
    expect(result.localIps).toContain('::ffff:10.0.0.1');
  });

  it('detects IPv4-mapped IPv6 172.16.x as private', async () => {
    const promise = runWebRtcTest();
    await vi.advanceTimersByTimeAsync(0);

    onicecandidate!({ candidate: { candidate: 'candidate:1 1 UDP 2130706431 ::ffff:172.16.0.1 12345 typ host' } });
    onicecandidate!({ candidate: null });

    const result = await promise;
    expect(result.localIps).toContain('::ffff:172.16.0.1');
  });

  it('detects IPv4-mapped IPv6 169.254.x as private', async () => {
    const promise = runWebRtcTest();
    await vi.advanceTimersByTimeAsync(0);

    onicecandidate!({ candidate: { candidate: 'candidate:1 1 UDP 2130706431 ::ffff:169.254.1.1 12345 typ host' } });
    onicecandidate!({ candidate: null });

    const result = await promise;
    expect(result.localIps).toContain('::ffff:169.254.1.1');
  });

  it('detects IPv4-mapped IPv6 127.x as private', async () => {
    const promise = runWebRtcTest();
    await vi.advanceTimersByTimeAsync(0);

    onicecandidate!({ candidate: { candidate: 'candidate:1 1 UDP 2130706431 ::ffff:127.0.0.1 12345 typ host' } });
    onicecandidate!({ candidate: null });

    const result = await promise;
    expect(result.localIps).toContain('::ffff:127.0.0.1');
  });

  it('captures public IP from host candidate (no NAT)', async () => {
    const promise = runWebRtcTest();
    await vi.advanceTimersByTimeAsync(0);

    onicecandidate!({ candidate: { candidate: 'candidate:0 1 UDP 2122252543 203.0.113.5 50000 typ host' } });
    onicecandidate!({ candidate: null });

    const result = await promise;
    expect(result.localIps).toContain('203.0.113.5');
    expect(result.leakDetected).toBe(true);
  });

  it('captures public IP from prflx candidate', async () => {
    const promise = runWebRtcTest();
    await vi.advanceTimersByTimeAsync(0);

    onicecandidate!({ candidate: { candidate: 'candidate:0 1 UDP 1694498815 198.51.100.42 50000 typ prflx' } });
    onicecandidate!({ candidate: null });

    const result = await promise;
    expect(result.publicIp).toBe('198.51.100.42');
  });

  it('still records srflx as publicIp', async () => {
    const promise = runWebRtcTest();
    await vi.advanceTimersByTimeAsync(0);

    onicecandidate!({ candidate: { candidate: 'candidate:0 1 UDP 1694498815 198.51.100.10 50000 typ srflx' } });
    onicecandidate!({ candidate: null });

    const result = await promise;
    expect(result.publicIp).toBe('198.51.100.10');
  });
});
