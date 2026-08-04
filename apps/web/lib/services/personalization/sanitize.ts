/**
 * Mirror of `apps/api/src/instance-config/authored-text.ts` — keep the two
 * byte-identical in behavior; the parity tests in `sanitize.test.ts` carry
 * real weight because this is a tokenizer, not a character map.
 *
 * Two rules, and nothing else:
 *
 * 1. **A value can never close a tag it did not open within that same value**
 *    — template-agnostic, so no wrapper can be terminated early.
 * 2. **A reserved tag name is never emitted as a tag at all**, opener or
 *    closer, matched or not. Rule 1 alone would let a value that both opens
 *    and closes `<user_personalization>` render a forged copy of the fence
 *    inside the real one.
 *
 * Everything else passes byte-for-byte — owners legitimately author structured
 * text (`<instructions>…</instructions>`), and entity-mangling every angle
 * bracket destroys exactly the structure that text exists to convey.
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
 * - Closer-shaped text that does not parse cleanly fails CLOSED and is escaped
 *   regardless of stack state: a model may still read it as a closer. `CLOSER`
 *   therefore tolerates no padding.
 * - Unmatched openers and non-tag prose (`a < b`, `<3`, `R&D`) pass through
 *   untouched.
 */

/** The packaged default's fence name — see the api copy for the full rationale. */
const RESERVED_TAG_NAMES: ReadonlySet<string> = new Set([
  "user_personalization",
]);

const OPENER = /^<([A-Za-z][\w.:-]*)(?:[\s/][^<>]*)?>$/u;
const CLOSER = /^<\/([A-Za-z][\w.:-]*)>$/u;
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
      if (opened !== -1 && !RESERVED_TAG_NAMES.has(name)) {
        stack.length = opened;
        out.push(token);
      } else {
        out.push(escapeAngles(token));
      }
      continue;
    }

    const opener = complete ? OPENER.exec(token) : null;
    if (opener !== null) {
      const name = opener[1].toLowerCase();
      if (RESERVED_TAG_NAMES.has(name)) {
        out.push(escapeAngles(token));
        continue;
      }
      if (!token.endsWith("/>")) {
        stack.push(name);
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
