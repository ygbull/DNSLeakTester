import type { Grade, ScanResults, TestVerdict } from '../scanner/types';

export function computeGrade(results: ScanResults): Grade {
  const rawVerdicts = [
    results.dns?.verdict,
    results.webrtc?.verdict,
    results.tls?.verdict,
    results.fingerprint?.verdict,
    results.geo?.verdict,
  ];

  // All tests errored — no data to grade
  if (rawVerdicts.every(v => v === null)) return 'F';

  // Errored tests (null) count as warnings — can't vouch for what we didn't test
  const verdicts = rawVerdicts.map(v => v ?? 'warn');

  const passCount = verdicts.filter(v => v === 'pass').length;
  const warnCount = verdicts.filter(v => v === 'warn').length;
  const failCount = verdicts.filter(v => v === 'fail').length;

  // Any fail caps at C
  if (failCount === 0 && warnCount === 0) return 'A';
  if (failCount === 0 && passCount >= 4) return 'B';
  if (failCount === 0) return 'C';
  if (passCount >= 3) return 'C';
  if (passCount >= 1) return 'D';
  return 'F';
}
