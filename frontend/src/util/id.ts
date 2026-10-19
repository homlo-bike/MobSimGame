/** Short random ids with a readable prefix, e.g. "line-3f9a1c2b". */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
