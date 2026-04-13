/**
 * Simple non-crypto hash for display purposes (profile IDs, fingerprint hashes).
 * Returns a short base-36 string. Not suitable for security — just identification.
 */
export function simpleHash(input: string): string {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  // Convert to unsigned, then base-36 for compact display
  return (h >>> 0).toString(36);
}
