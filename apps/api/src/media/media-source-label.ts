import { sanitizeAuthoredText } from '../instance-config/authored-text';

const MAX_LABEL_UTF16_UNITS = 256;

// Control characters (C0, DEL, C1) plus the Unicode line and paragraph
// separators, which render as line breaks although they are not controls.
const LINE_BREAKING = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

/**
 * The stored source label of a media object (`media-store` spec): the upload
 * filename, made single-line, unable to forge an `[image ...]` placeholder or
 * a reserved delimiter, and bounded.
 */
export function mediaSourceLabel(source: string): string {
  const neutralized = sanitizeAuthoredText(
    source
      .replace(LINE_BREAKING, ' ')
      .replaceAll('[', '(')
      .replaceAll(']', ')'),
  );
  if (neutralized.length <= MAX_LABEL_UTF16_UNITS) return neutralized;

  const cut = neutralized.slice(0, MAX_LABEL_UTF16_UNITS);
  const last = cut.charCodeAt(cut.length - 1);
  // Never end on the high half of a surrogate pair.
  return last >= 0xd8_00 && last <= 0xdb_ff ? cut.slice(0, -1) : cut;
}
