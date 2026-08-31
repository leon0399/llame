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
 *    and closes a packaged fence render a forged copy inside the real one.
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

/**
 * Tag names an authored value may never emit as a tag. This includes llame's
 * packaged personalization and chat-history fences plus the server-authored
 * structural labels used for context reminders, compaction history, and tool
 * observations.
 */
const RESERVED_TAG_NAMES: ReadonlySet<string> = new Set([
  // Exactly the three retired rail delimiters are gone: `conversation-checkpoint`,
  // `chat-recency-update`, and `runtime-tool-availability` no longer exist, since
  // every context item now shares one envelope. Every OTHER entry below is
  // unrelated to the rail and stays reserved — dropping them with the rail's
  // would be an escaping regression a test that only forges `system-reminder`
  // would never catch.
  "system-reminder",
  "tool-call",
  "tool-result",
  "user_chat_history",
  "user_personalization",
]);

/**
 * Any tag-SHAPED token naming a reserved wrapper, however sloppily spelled:
 * `<user_personalization>`, `< user_personalization>`, `</ user_personalization >`,
 * or an unterminated `<user_personalization foo="`.
 *
 * Reservation must not depend on the token parsing cleanly. `OPENER`/`CLOSER`
 * are strict by design, so a padded or unterminated spelling fell through to
 * the pass-through branch with the reserved name intact — and a model reading
 * that as an opener can pair it with the template's REAL closer, leaving every
 * system section after the fence sitting inside the untrusted block. The same
 * fail-closed reasoning already applied to malformed closers; it applies to
 * reserved names in any position.
 */
const RESERVED_INTENT = /^<\s*\/?\s*([A-Za-z][\w.:-]*)/u;

const OPENER = /^<([A-Za-z][\w.:-]*)(?:[\s/][^<>]*)?>$/u;
const CLOSER = /^<\/([A-Za-z][\w.:-]*)>$/u;
/** Anything that starts like a closing tag, however malformed. */
const CLOSER_INTENT = /^<\s*\//u;

const escapeAngles = (token: string) =>
  token.replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * The markup-ish token starting at `lt`. A token runs to the next `>`, unless
 * another `<` starts first — then the fragment is unterminated and the next
 * `<` begins its own token.
 */
function nextToken(value: string, lt: number) {
  const gt = value.indexOf(">", lt + 1);
  const nextLt = value.indexOf("<", lt + 1);
  const complete = gt !== -1 && (nextLt === -1 || gt < nextLt);
  const end = complete ? gt + 1 : nextLt === -1 ? value.length : nextLt;
  return { token: value.slice(lt, end), end, complete };
}

/**
 * Decide what one token emits, and update the open-tag stack. This is the
 * whole security decision: a value may never close a tag it did not open
 * within that same value, and may never emit a reserved delimiter name as a
 * tag at all. `stack` is mutated, exactly as it was when this lived inline.
 */
function emitToken(
  token: string,
  complete: boolean,
  stack: Array<string>,
): string {
  const reserved = RESERVED_INTENT.exec(token);
  if (reserved !== null && RESERVED_TAG_NAMES.has(reserved[1].toLowerCase())) {
    return escapeAngles(token);
  }

  const closer = complete ? CLOSER.exec(token) : null;
  if (closer !== null) {
    const name = closer[1].toLowerCase();
    const opened = stack.lastIndexOf(name);
    if (opened !== -1 && !RESERVED_TAG_NAMES.has(name)) {
      stack.length = opened;
      return token;
    }
    return escapeAngles(token);
  }

  const opener = complete ? OPENER.exec(token) : null;
  if (opener !== null) {
    if (!token.endsWith("/>")) {
      stack.push(opener[1].toLowerCase());
    }
    return token;
  }

  if (CLOSER_INTENT.test(token)) {
    return escapeAngles(token);
  }
  // Prose or an unterminated opener fragment, neither of which can close
  // anything.
  return token;
}

export function sanitizeAuthoredText(value: string): string {
  const out: Array<string> = [];
  const stack: Array<string> = [];
  let index = 0;

  while (index < value.length) {
    const lt = value.indexOf("<", index);
    if (lt === -1) {
      out.push(value.slice(index));
      break;
    }
    out.push(value.slice(index, lt));

    const { token, end, complete } = nextToken(value, lt);
    index = end;
    out.push(emitToken(token, complete, stack));
  }

  return out.join("");
}
