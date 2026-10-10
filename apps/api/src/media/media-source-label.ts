import { sanitizeAuthoredText } from '../instance-config/authored-text';

const MAX_LABEL_UTF16_UNITS = 256;

// Scheme, then authority (up to the path), then path (up to query/fragment).
const WEB_LOCATOR = /^(https?:\/\/)([^/\\?#]*)([^?#]*)/iu;

// Control characters (C0, DEL, C1) plus the Unicode line and paragraph
// separators, which render as line breaks although they are not controls.
const LINE_BREAKING = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

/**
 * The stored source label of a media object (`media-store` spec): an upload
 * filename or a `read`/`prompt-import` locator, made single-line, unable to
 * forge an `[image ...]` placeholder or a reserved delimiter, and bounded.
 * An `http(s)` locator keeps only scheme, host, port, and path, so userinfo,
 * query tokens, and fragments are never stored.
 */
export function mediaSourceLabel(source: string): string {
  const web = WEB_LOCATOR.exec(source);
  const text =
    web === null
      ? source
      : `${web[1]}${web[2].slice(web[2].lastIndexOf('@') + 1)}${web[3]}`;

  const neutralized = sanitizeAuthoredText(
    text.replace(LINE_BREAKING, ' ').replaceAll('[', '(').replaceAll(']', ')'),
  );
  if (neutralized.length <= MAX_LABEL_UTF16_UNITS) return neutralized;

  const cut = neutralized.slice(0, MAX_LABEL_UTF16_UNITS);
  const last = cut.charCodeAt(cut.length - 1);
  // Never end on the high half of a surrogate pair.
  return last >= 0xd8_00 && last <= 0xdb_ff ? cut.slice(0, -1) : cut;
}
