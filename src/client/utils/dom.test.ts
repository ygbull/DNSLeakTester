import { describe, it, expect } from 'vitest';
import { escapeHtml, truncate } from './dom';

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it('escapes quotes for attribute context safety', () => {
    expect(escapeHtml('" onmouseover="alert(1)')).toBe('&quot; onmouseover=&quot;alert(1)');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('passes through safe strings unchanged', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });
});

describe('truncate', () => {
  it('truncates long strings with ellipsis', () => {
    expect(truncate('hello world this is a long string', 10)).toBe('hello worl...');
  });

  it('returns short strings unchanged', () => {
    expect(truncate('short', 10)).toBe('short');
  });

  it('handles exact length', () => {
    expect(truncate('12345', 5)).toBe('12345');
  });

  it('handles empty string', () => {
    expect(truncate('', 5)).toBe('');
  });

  it('truncate before escapeHtml avoids broken entities', () => {
    const raw = "it's a long value that should be cut off";
    const result = escapeHtml(truncate(raw, 10));
    // Must not contain a broken entity like &#3...
    expect(result).not.toMatch(/&[^;]*\.\.\./);
    expect(result).toContain('&#39;');
  });
});
