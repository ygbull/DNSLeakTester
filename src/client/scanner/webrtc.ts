import type { WebRtcResult } from './types';

function isPrivateIp(ip: string): boolean {
  if (/^10\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^127\./.test(ip)) return true;
  // IPv4-mapped IPv6
  if (/^::ffff:10\./i.test(ip)) return true;
  if (/^::ffff:172\.(1[6-9]|2\d|3[01])\./i.test(ip)) return true;
  if (/^::ffff:192\.168\./i.test(ip)) return true;
  if (/^::ffff:169\.254\./i.test(ip)) return true;
  if (/^::ffff:127\./i.test(ip)) return true;
  // IPv6
  if (/^fe80:/i.test(ip)) return true;
  if (/^fd[0-9a-f]{2}:/i.test(ip)) return true;
  if (/^::1$/.test(ip)) return true;
  return false;
}

export async function runWebRtcTest(signal?: AbortSignal): Promise<WebRtcResult> {
  if (typeof RTCPeerConnection === 'undefined') {
    return { webrtcSupported: false, localIps: [], publicIp: null, mdnsAddresses: [], leakDetected: false };
  }

  const ips = new Set<string>();
  const mdns = new Set<string>();

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  return new Promise((resolve, reject) => {
    let finished = false;
    const timeout = setTimeout(() => finish(), 5000);

    if (signal) {
      if (signal.aborted) { cleanup(); reject(signal.reason); return; }
      signal.addEventListener('abort', () => {
        if (finished) return;
        cleanup();
        reject(signal.reason);
      }, { once: true });
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) { finish(); return; }
      const candidate = event.candidate.candidate;
      if (!candidate) return;

      const parts = candidate.split(' ');
      const ip = parts[4];
      const type = parts[7];
      if (!ip) return;

      if (ip.endsWith('.local')) {
        mdns.add(ip);
      } else if (isPrivateIp(ip)) {
        ips.add(ip);
      } else if (type === 'srflx' || type === 'prflx') {
        ips.add(`public:${ip}`);
      } else {
        // host candidate with public IP — machine has directly-assigned public IP
        ips.add(ip);
      }
    };

    pc.createDataChannel('');
    pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => {});

    function cleanup() {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      pc.close();
    }

    function finish() {
      cleanup();

      const localIps = [...ips].filter(ip => !ip.startsWith('public:'));
      const publicIp = [...ips].find(ip => ip.startsWith('public:'))?.replace('public:', '') ?? null;

      resolve({
        webrtcSupported: true,
        localIps,
        publicIp,
        mdnsAddresses: [...mdns],
        leakDetected: localIps.length > 0,
      });
    }
  });
}
