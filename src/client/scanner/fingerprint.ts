import { simpleHash } from '../../shared/hash';
import type { FingerprintResult, FingerprintComponent } from './types';

const ENTROPY_ESTIMATES: Record<string, number> = {
  userAgent:          10.0,
  platform:            3.5,
  language:            4.0,
  timezone:            3.0,
  screenResolution:    4.5,
  colorDepth:          1.5,
  devicePixelRatio:    2.5,
  hardwareConcurrency: 2.5,
  deviceMemory:        2.0,
  touchSupport:        1.5,
  canvas:              8.0,
  webglRenderer:       6.0,
  webglVendor:         2.5,
  fonts:               5.5,
  doNotTrack:          0.5,
  cookieEnabled:       0.3,
  pdfViewer:           0.5,
  audioContext:         3.0,
};

const CORRELATION_DISCOUNT = 0.7;

const TEST_FONTS = [
  'Arial', 'Verdana', 'Times New Roman', 'Trebuchet MS', 'Georgia',
  'Palatino', 'Garamond', 'Bookman Old Style', 'Comic Sans MS',
  'Courier New', 'Impact', 'Lucida Console', 'Tahoma',
  'Century Gothic', 'Helvetica', 'Monaco', 'Menlo',
  'Consolas', 'Calibri', 'Cambria', 'Segoe UI',
  'Ubuntu', 'Roboto', 'Noto Sans', 'Fira Code',
];

const BASELINE_FONTS = ['monospace', 'sans-serif', 'serif'];

function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'unsupported';

    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('LeakTest,\ud83d\ude03', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('LeakTest,\ud83d\ude03', 4, 17);

    return simpleHash(canvas.toDataURL());
  } catch {
    return 'blocked';
  }
}

function getWebGLInfo(): { renderer: string; vendor: string } {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
    if (!gl) return { renderer: 'unsupported', vendor: 'unsupported' };

    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return { renderer: 'hidden', vendor: 'hidden' };

    return {
      renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? 'unknown',
      vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? 'unknown',
    };
  } catch {
    return { renderer: 'blocked', vendor: 'blocked' };
  }
}

function detectFonts(): string[] {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const testString = 'mmmmmmmmmmlli';
    const fontSize = '72px';

    const baselines: Record<string, number> = {};
    for (const base of BASELINE_FONTS) {
      ctx.font = `${fontSize} ${base}`;
      baselines[base] = ctx.measureText(testString).width;
    }

    const detected: string[] = [];
    for (const font of TEST_FONTS) {
      for (const base of BASELINE_FONTS) {
        ctx.font = `${fontSize} '${font}', ${base}`;
        if (ctx.measureText(testString).width !== baselines[base]) {
          detected.push(font);
          break;
        }
      }
    }
    return detected;
  } catch {
    return [];
  }
}

async function getAudioFingerprint(): Promise<string> {
  try {
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    const oscillator = ctx.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(10000, ctx.currentTime);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-50, ctx.currentTime);
    compressor.knee.setValueAtTime(40, ctx.currentTime);
    compressor.ratio.setValueAtTime(12, ctx.currentTime);
    compressor.attack.setValueAtTime(0, ctx.currentTime);
    compressor.release.setValueAtTime(0.25, ctx.currentTime);

    oscillator.connect(compressor);
    compressor.connect(ctx.destination);
    oscillator.start(0);

    const buffer = await ctx.startRendering();
    const data = buffer.getChannelData(0);

    let sum = 0;
    for (let i = 4500; i < 5000; i++) {
      sum += Math.abs(data[i]);
    }
    return sum.toFixed(6);
  } catch {
    return 'unsupported';
  }
}

function calculateTotalEntropy(components: FingerprintComponent[]): number {
  const naiveSum = components.reduce((sum, c) => sum + c.entropy, 0);
  return Math.round(naiveSum * CORRELATION_DISCOUNT * 10) / 10;
}

export async function runFingerprintTest(): Promise<FingerprintResult> {
  const webgl = getWebGLInfo();
  const fonts = detectFonts();
  const audio = await getAudioFingerprint();

  const nav = navigator as unknown as Record<string, unknown>;

  const components: FingerprintComponent[] = [
    { name: 'userAgent', value: navigator.userAgent, entropy: ENTROPY_ESTIMATES.userAgent },
    { name: 'platform', value: navigator.platform, entropy: ENTROPY_ESTIMATES.platform },
    { name: 'language', value: `${navigator.language}|${navigator.languages?.join(',')}`, entropy: ENTROPY_ESTIMATES.language },
    { name: 'timezone', value: Intl.DateTimeFormat().resolvedOptions().timeZone, entropy: ENTROPY_ESTIMATES.timezone },
    { name: 'screenResolution', value: `${screen.width}x${screen.height}`, entropy: ENTROPY_ESTIMATES.screenResolution },
    { name: 'colorDepth', value: String(screen.colorDepth), entropy: ENTROPY_ESTIMATES.colorDepth },
    { name: 'devicePixelRatio', value: String(window.devicePixelRatio), entropy: ENTROPY_ESTIMATES.devicePixelRatio },
    { name: 'hardwareConcurrency', value: String(navigator.hardwareConcurrency ?? 'unknown'), entropy: ENTROPY_ESTIMATES.hardwareConcurrency },
    { name: 'deviceMemory', value: String(nav.deviceMemory ?? 'unknown'), entropy: nav.deviceMemory ? ENTROPY_ESTIMATES.deviceMemory : 0 },
    { name: 'touchSupport', value: String(navigator.maxTouchPoints), entropy: ENTROPY_ESTIMATES.touchSupport },
    { name: 'canvas', value: getCanvasFingerprint(), entropy: ENTROPY_ESTIMATES.canvas },
    { name: 'webglRenderer', value: webgl.renderer, entropy: webgl.renderer === 'blocked' ? 0 : ENTROPY_ESTIMATES.webglRenderer },
    { name: 'webglVendor', value: webgl.vendor, entropy: webgl.vendor === 'blocked' ? 0 : ENTROPY_ESTIMATES.webglVendor },
    { name: 'fonts', value: `${fonts.length} fonts: ${fonts.slice(0, 5).join(', ')}${fonts.length > 5 ? '...' : ''}`, entropy: ENTROPY_ESTIMATES.fonts },
    { name: 'doNotTrack', value: String(navigator.doNotTrack ?? 'unset'), entropy: ENTROPY_ESTIMATES.doNotTrack },
    { name: 'cookieEnabled', value: String(navigator.cookieEnabled), entropy: ENTROPY_ESTIMATES.cookieEnabled },
    { name: 'pdfViewer', value: String(nav.pdfViewerEnabled ?? 'unknown'), entropy: ENTROPY_ESTIMATES.pdfViewer },
    { name: 'audioContext', value: audio, entropy: audio === 'unsupported' ? 0 : ENTROPY_ESTIMATES.audioContext },
  ];

  const entropy = calculateTotalEntropy(components);
  const uniqueAmong = Math.round(Math.pow(2, entropy));

  return { entropy, components, uniqueAmong };
}
