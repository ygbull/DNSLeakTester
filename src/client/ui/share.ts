import type { ScanResults, TestResult, DnsLeakResult, WebRtcResult, FingerprintResult } from '../scanner/types';
import { showToast } from '../utils/dom';

const SHARE_LABEL = 'Share Results';
let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

export interface ShareableResults {
  v: 1;
  t: number;
  g: string;
  d: ShareableTest;
  w: ShareableTest;
  l: ShareableTest;
  f: ShareableTest;
  i: ShareableTest;
}

interface ShareableTest {
  v: string;
  s: string;
}

function getShareableSummaryText(result: TestResult): string {
  if (!result.data) return result.error ?? 'Test failed';

  switch (result.id) {
    case 'dns': {
      const data = result.data as DnsLeakResult;
      if (data.leakDetected) return `${data.resolverCount} resolvers — possible leak`;
      if (result.verdict === 'warn') return `${data.resolverCount} resolver — inconclusive`;
      return `${data.resolverCount} resolver — no leak`;
    }
    case 'webrtc': {
      const data = result.data as WebRtcResult;
      return data.leakDetected ? 'Local IP exposed' : 'No IP leak detected';
    }
    case 'tls':
      return result.verdict === 'pass' ? 'Standard TLS profile' : 'Unusual TLS profile';
    case 'fingerprint': {
      const data = result.data as FingerprintResult;
      return `${data.entropy.toFixed(1)} bits of entropy`;
    }
    case 'geo':
      return result.verdict === 'pass' ? 'VPN detected' : 'No VPN detected';
    default: return '';
  }
}

export function encodeResults(results: ScanResults): string {
  const shareable: ShareableResults = {
    v: 1,
    t: results.timestamp,
    g: results.overallGrade,
    d: { v: results.dns.verdict ?? 'error', s: getShareableSummaryText(results.dns) },
    w: { v: results.webrtc.verdict ?? 'error', s: getShareableSummaryText(results.webrtc) },
    l: { v: results.tls.verdict ?? 'error', s: getShareableSummaryText(results.tls) },
    f: { v: results.fingerprint.verdict ?? 'error', s: getShareableSummaryText(results.fingerprint) },
    i: { v: results.geo.verdict ?? 'error', s: getShareableSummaryText(results.geo) },
  };

  const json = JSON.stringify(shareable);
  const bytes = new TextEncoder().encode(json);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeResults(fragment: string): ShareableResults | null {
  try {
    const padded = fragment.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);

    if (parsed.v !== 1) return null;
    const VALID_VERDICTS = ['pass', 'warn', 'fail', 'error'];
    if (typeof parsed.g !== 'string' || typeof parsed.t !== 'number') return null;
    const VALID_GRADES = ['A', 'B', 'C', 'D', 'F'];
    if (!VALID_GRADES.includes(parsed.g)) return null;
    for (const key of ['d', 'w', 'l', 'f', 'i']) {
      const test = parsed[key];
      if (!test || typeof test.v !== 'string' || typeof test.s !== 'string') return null;
      if (!VALID_VERDICTS.includes(test.v)) return null;
      if (test.s.length > 200) return null;
    }
    return parsed as ShareableResults;
  } catch {
    return null;
  }
}

export function checkForSharedResults(): ShareableResults | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#r=')) return null;
  return decodeResults(hash.slice(3));
}

export function shareResults(results: ScanResults): void {
  const encoded = encodeResults(results);
  const url = `${window.location.origin}${window.location.pathname}#r=${encoded}`;
  const btn = document.getElementById('btn-share')!;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      if (feedbackTimer !== null) clearTimeout(feedbackTimer);
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      feedbackTimer = setTimeout(() => {
        feedbackTimer = null;
        btn.textContent = SHARE_LABEL;
        btn.classList.remove('copied');
      }, 2000);
      showToast('Link copied to clipboard!');
    }).catch(() => {
      prompt('Copy this link:', url);
    });
  } else {
    prompt('Copy this link:', url);
  }
}
