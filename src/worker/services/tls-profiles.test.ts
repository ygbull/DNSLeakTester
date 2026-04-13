import { describe, it, expect } from 'vitest';
import { computeProfileId, lookupProfile, COLO_LOOKUP } from './tls-profiles';
import type { TlsProfile } from './tls-profiles';

describe('computeProfileId', () => {
  it('returns a consistent hash for the same input', () => {
    const profile: TlsProfile = {
      version: 'TLSv1.3',
      cipher: 'AEAD-AES128-GCM-SHA256',
      protocol: 'HTTP/2',
      ciphersSha1: 'abc123',
      extensionsSha1: 'def456',
      helloLength: '512',
    };
    const id1 = computeProfileId(profile);
    const id2 = computeProfileId(profile);
    expect(id1).toBe(id2);
  });

  it('returns different hashes for different inputs', () => {
    const p1: TlsProfile = {
      version: 'TLSv1.3', cipher: 'A', protocol: 'HTTP/2',
      ciphersSha1: 'aaa', extensionsSha1: 'bbb', helloLength: '100',
    };
    const p2: TlsProfile = {
      version: 'TLSv1.3', cipher: 'A', protocol: 'HTTP/2',
      ciphersSha1: 'ccc', extensionsSha1: 'bbb', helloLength: '100',
    };
    expect(computeProfileId(p1)).not.toBe(computeProfileId(p2));
  });

  it('returns a base-36 string', () => {
    const profile: TlsProfile = {
      version: 'TLSv1.3', cipher: 'X', protocol: 'HTTP/2',
      ciphersSha1: 'x', extensionsSha1: 'y', helloLength: '1',
    };
    const id = computeProfileId(profile);
    expect(/^[0-9a-z]+$/.test(id)).toBe(true);
  });
});

describe('lookupProfile', () => {
  it('returns null for unknown profiles', () => {
    expect(lookupProfile('nonexistent')).toBeNull();
  });
});

describe('COLO_LOOKUP', () => {
  it('maps DFW to Dallas, US', () => {
    expect(COLO_LOOKUP['DFW']).toEqual({ city: 'Dallas', country: 'US' });
  });

  it('maps NRT to Tokyo, JP', () => {
    expect(COLO_LOOKUP['NRT']).toEqual({ city: 'Tokyo', country: 'JP' });
  });

  it('maps AMS to Amsterdam, NL', () => {
    expect(COLO_LOOKUP['AMS']).toEqual({ city: 'Amsterdam', country: 'NL' });
  });

  it('has at least 40 entries', () => {
    expect(Object.keys(COLO_LOOKUP).length).toBeGreaterThanOrEqual(40);
  });
});
