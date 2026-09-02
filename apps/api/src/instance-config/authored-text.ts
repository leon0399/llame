/**
 * Sanitizes owner-authored personalization text for inclusion in a rendered
 * prompt.
 *
 * Two rules, and nothing else:
 *
 * 1. **A value can never close a tag it did not open within that same value.**
 *    This is template-agnostic — it keeps whatever wrapper the surrounding
 *    template uses from being terminated early, without this module knowing
 *    the wrapper's name.
 * 2. **A reserved tag name is never emitted as a tag at all**, opener or
 *    closer, matched or not. Rule 1 alone is not enough: a value that both
 *    opens AND closes a packaged fence satisfies it while rendering a complete
 *    forged copy inside the real one, so each fence's own name has to be
 *    spelled out here.
 *
 * Everything else passes byte-for-byte: owners legitimately author structured
 * text (`<instructions>…</instructions>`), and entity-mangling every angle
 * bracket destroys exactly the structure that text exists to convey. `&` is
 * left alone for the same reason.
 *
 * Mechanics: a stack matcher over tag-shaped tokens.
 *
 * - A closer whose name matches ANY still-open in-value opener pops through to
 *   it and passes — HTML-style recovery, not strict XML. Strictness would
 *   betray real data: prose like "ALWAYS follow <answering_rules>" reads as an
 *   opener, and requiring the innermost match would then escape the legitimate
 *   outer closer. Popping through phantoms keeps the invariant intact: the
 *   closer still names a tag this value opened earlier.
 * - A closer naming no in-value opener is entity-escaped. A counter is not
 *   enough: `</x>text<x>` is count-balanced yet its closer precedes its
 *   opener, so it would close the ENCLOSING tag — matching must be positional.
 * - Closer-shaped text that does not parse cleanly (`</ user_personalization >`,
 *   `</tag junk>`, an unterminated trailing `</tag`) fails CLOSED and is
 *   escaped regardless of stack state: a model may still read it as a closer
 *   even though a strict parser would not. `CLOSER` therefore tolerates no
 *   padding — a padded spelling must reach the escape branch, not match and
 *   pop a legitimate opener.
 * - Unmatched openers pass through. They cannot break out of the fence — at
 *   worst they nest a phantom block inside it.
 * - Non-tag text involving `<` (`a < b`, `<3`, `i<10`) passes through
 *   untouched; only name-initiated tag shapes are considered at all.
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
  'system-reminder',
  'tool-call',
  'tool-result',
  'user_chat_history',
  'user_personalization',
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
  token.replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * The markup-ish token starting at `lt`. A token runs to the next `>`, unless
 * another `<` starts first — then the fragment is unterminated and the next
 * `<` begins its own token.
 */
function nextToken(value: string, lt: number) {
  const gt = value.indexOf('>', lt + 1);
  const nextLt = value.indexOf('<', lt + 1);
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
    if (!token.endsWith('/>')) {
      stack.push(opener[1].toLowerCase());
    }
    return token;
  }

  if (CLOSER_INTENT.test(token)) {
    return escapeAngles(token);
  }
  // Prose (`a < b`, `<3`) or an unterminated opener fragment, neither of
  // which can close anything.
  return token;
}

export function sanitizeAuthoredText(value: string): string {
  const out: Array<string> = [];
  const stack: Array<string> = [];
  let index = 0;

  while (index < value.length) {
    const lt = value.indexOf('<', index);
    if (lt === -1) {
      out.push(value.slice(index));
      break;
    }
    out.push(value.slice(index, lt));

    const { token, end, complete } = nextToken(value, lt);
    index = end;
    out.push(emitToken(token, complete, stack));
  }

  return out.join('');
}
