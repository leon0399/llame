/**
 * Mirror of `apps/api/src/instance-config/authored-text.ts` — keep the two
 * byte-identical in behavior; the parity tests in `sanitize.test.ts` carry
 * real weight because this is a tokenizer, not a character map.
 *
 * The invariant, and the ONLY transformation applied: **a value can never
 * close a tag it did not open within that same value.** Everything else
 * passes byte-for-byte — owners legitimately author structured text
 * (`<instructions>…</instructions>`), and entity-mangling every angle bracket
 * destroys exactly the structure that text exists to convey.
 *
 * Mechanics: a stack matcher over tag-shaped tokens.
 *
 * - A closer whose name matches ANY still-open in-value opener pops through to
 *   it and passes — HTML-style recovery, not strict XML, so prose mentions
 *   like "follow <answering_rules>" cannot get a legitimate outer closer
 *   escaped.
 * - A closer naming no in-value opener is entity-escaped. A counter is not
 *   enough: `</x>text<x>` is count-balanced yet its closer precedes its
 *   opener — matching must be positional.
 * - Closer-shaped text that does not parse cleanly fails CLOSED and is
 *   escaped: a model may still read it as a closer.
 * - Unmatched openers and non-tag prose (`a < b`, `<3`, `R&D`) pass through
 *   untouched.
 */

const OPENER = /^<([A-Za-z][\w.:-]*)(?:[\s/][^<>]*)?>$/u;
const CLOSER = /^<\/\s*([A-Za-z][\w.:-]*)\s*>$/u;
/** Anything that starts like a closing tag, however malformed. */
const CLOSER_INTENT = /^<\s*\//u;
/** A complete bracket group that starts like an opening tag. */
const OPENER_INTENT = /^<[A-Za-z]/u;

const escapeAngles = (token: string) =>
  token.replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function sanitizeAuthoredText(value: string): string {
  const out: string[] = [];
  const stack: string[] = [];
  let index = 0;

  while (index < value.length) {
    const lt = value.indexOf("<", index);
    if (lt === -1) {
      out.push(value.slice(index));
      break;
    }
    out.push(value.slice(index, lt));

    // A token runs to the next `>`, unless another `<` starts first — then the
    // fragment is unterminated and the next `<` begins its own token.
    const gt = value.indexOf(">", lt + 1);
    const nextLt = value.indexOf("<", lt + 1);
    const complete = gt !== -1 && (nextLt === -1 || gt < nextLt);
    const end = complete ? gt + 1 : nextLt === -1 ? value.length : nextLt;
    const token = value.slice(lt, end);
    index = end;

    const closer = complete ? CLOSER.exec(token) : null;
    if (closer !== null) {
      const name = closer[1].toLowerCase();
      const opened = stack.lastIndexOf(name);
      if (opened !== -1) {
        stack.length = opened;
        out.push(token);
      } else {
        out.push(escapeAngles(token));
      }
      continue;
    }

    const opener = complete ? OPENER.exec(token) : null;
    if (opener !== null) {
      if (!token.endsWith("/>")) {
        stack.push(opener[1].toLowerCase());
      }
      out.push(token);
      continue;
    }

    if (CLOSER_INTENT.test(token)) {
      out.push(escapeAngles(token));
      continue;
    }
    if (complete && OPENER_INTENT.test(token)) {
      // Tag-intent but malformed — fail closed like a sloppy closer.
      out.push(escapeAngles(token));
      continue;
    }

    // Prose or an unterminated opener fragment, neither of which can close
    // anything.
    out.push(token);
  }

  return out.join("");
}
