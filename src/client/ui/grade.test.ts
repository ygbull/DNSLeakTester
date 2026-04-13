import { describe, it, expect } from 'vitest';
import { computeGrade } from './grade';
import type { ScanResults, TestResult, TestVerdict } from '../scanner/types';

function mockResult(verdict: TestVerdict | null): TestResult {
  return {
    id: 'test', name: 'Test', status: verdict ? 'complete' : 'error',
    verdict, data: null, error: null, durationMs: 0,
  };
}

function makeResults(verdicts: (TestVerdict | null)[]): ScanResults {
  return {
    sessionId: 'test', timestamp: Date.now(),
    dns: mockResult(verdicts[0]),
    webrtc: mockResult(verdicts[1]),
    tls: mockResult(verdicts[2]),
    fingerprint: mockResult(verdicts[3]),
    geo: mockResult(verdicts[4]),
    overallGrade: 'F',
  };
}

describe('computeGrade', () => {
  it('returns A when all pass', () => {
    expect(computeGrade(makeResults(['pass', 'pass', 'pass', 'pass', 'pass']))).toBe('A');
  });

  it('returns B when 4 pass and 1 warn', () => {
    expect(computeGrade(makeResults(['pass', 'pass', 'pass', 'pass', 'warn']))).toBe('B');
  });

  it('returns C when 3 pass and 2 warn', () => {
    expect(computeGrade(makeResults(['pass', 'pass', 'pass', 'warn', 'warn']))).toBe('C');
  });

  it('caps at C when any test fails with 3+ passes', () => {
    expect(computeGrade(makeResults(['pass', 'pass', 'pass', 'pass', 'fail']))).toBe('C');
  });

  it('returns D when 1-2 pass with fails', () => {
    expect(computeGrade(makeResults(['pass', 'fail', 'fail', 'fail', 'fail']))).toBe('D');
  });

  it('returns F when all fail', () => {
    expect(computeGrade(makeResults(['fail', 'fail', 'fail', 'fail', 'fail']))).toBe('F');
  });

  it('returns F when no verdicts', () => {
    expect(computeGrade(makeResults([null, null, null, null, null]))).toBe('F');
  });

  it('handles mixed verdicts with fails capping at C', () => {
    expect(computeGrade(makeResults(['pass', 'pass', 'pass', 'warn', 'fail']))).toBe('C');
  });

  it('returns C with all warns, no fails', () => {
    expect(computeGrade(makeResults(['warn', 'warn', 'warn', 'warn', 'warn']))).toBe('C');
  });

  // Scoring policy: errored tests (null verdict) count as warnings
  it('returns B when 4 pass and 1 error (null verdict counts as warn)', () => {
    expect(computeGrade(makeResults(['pass', 'pass', 'pass', 'pass', null]))).toBe('B');
  });

  it('returns C when 3 pass and 2 errors', () => {
    expect(computeGrade(makeResults(['pass', 'pass', 'pass', null, null]))).toBe('C');
  });

  it('returns C when dns warns explicitly and geo errors (geo-unavailable scenario)', () => {
    // After fix: dns='warn' (explicit), webrtc='pass', tls='pass', fp='pass', geo=null
    // null→warn mapping: 3 pass + 2 warn + 0 fail → C
    expect(computeGrade(makeResults(['warn', 'pass', 'pass', 'pass', null]))).toBe('C');
  });
});
