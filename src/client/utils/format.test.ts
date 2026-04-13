import { describe, it, expect } from 'vitest';
import { formatMs, formatBits, formatUniqueIn } from './format';

describe('formatMs', () => {
  it('formats milliseconds under 1000', () => {
    expect(formatMs(150)).toBe('150ms');
    expect(formatMs(0)).toBe('0ms');
    expect(formatMs(999)).toBe('999ms');
  });

  it('formats seconds for 1000+', () => {
    expect(formatMs(1000)).toBe('1.0s');
    expect(formatMs(1500)).toBe('1.5s');
    expect(formatMs(12345)).toBe('12.3s');
  });
});

describe('formatBits', () => {
  it('formats with one decimal place', () => {
    expect(formatBits(28.5)).toBe('28.5 bits');
    expect(formatBits(0)).toBe('0.0 bits');
    expect(formatBits(42.56)).toBe('42.6 bits');
  });
});

describe('formatUniqueIn', () => {
  it('computes 2^entropy', () => {
    expect(formatUniqueIn(10)).toBe(1024);
    expect(formatUniqueIn(20)).toBe(1048576);
    expect(formatUniqueIn(0)).toBe(1);
  });

  it('rounds to integer', () => {
    expect(typeof formatUniqueIn(15.5)).toBe('number');
    expect(Number.isInteger(formatUniqueIn(15.5))).toBe(true);
  });
});
