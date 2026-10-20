/**
 * The canonical encoding shared by the remote locator grammars: a decoded
 * absolute path becomes the one spelling a locator formatter reports, so
 * decoding stays one layer. Only the characters the grammars reserve are
 * escaped — `%` (so `%XX` stays literal text after one decode), the literals
 * `#`, `?`, and `\`, control characters, and any `:` after the last `/` (which
 * a read selector split would otherwise claim).
 */

const SEPARATOR = '/';

/**
 * Encode one decoded absolute path. Returns `undefined` when the input cannot
 * be a canonical path at all: a relative value or a NUL.
 */
export function encodeLocatorPath(path: string): string | undefined {
  if (!path.startsWith('/') || path.includes('\u0000')) return undefined;
  const lastSeparator = path.lastIndexOf(SEPARATOR);
  let encoded = '';
  for (let index = 0; index < path.length; index += 1) {
    encoded += encodeCharacter(path.charCodeAt(index), index > lastSeparator);
  }
  return encoded;
}

function encodeCharacter(code: number, afterLastSeparator: boolean): string {
  if (code === 0x25) return '%25';
  if (code === 0x23) return '%23';
  if (code === 0x3f) return '%3F';
  if (code === 0x5c) return '%5C';
  if (code === 0x3a && afterLastSeparator) return '%3A';
  if (code <= 0x1f || code === 0x7f)
    return `%${code.toString(16).padStart(2, '0').toUpperCase()}`;
  return String.fromCharCode(code);
}
