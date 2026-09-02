import {
  findRegexCandidates,
  splitBySpans,
  type RegexCandidate,
} from "@workspace/ui/lib/regex-detect";
import { decodeString } from "micromark-util-decode-string";
import { REGEX_TOKEN_TAG } from "#regex-tester/token";

/**
 * Streamdown Markdown wiring for the message regex tester: remark and rehype
 * rewrites wrap regex literals in prose and inline code with `<regex-token>`
 * elements. Fenced-code decoration lives in the sibling code-highlighter
 * adapter; both surfaces communicate with the provider through the shared
 * token protocol.
 */

/** `allowedTags` entry that lets `<regex-token>` survive rehype-sanitize. */
export const regexTokenAllowedTags = { [REGEX_TOKEN_TAG]: [] };

/** hast attribute value shapes (hast-util-to-jsx-runtime's `Properties` contract). */
type HastPropertyValue = boolean | number | string;

type HastNode =
  | { type: "text"; value: string }
  | { type: "root"; children: Array<HastNode> }
  | {
      type: "element";
      tagName: string;
      properties: Record<string, HastPropertyValue | Array<HastPropertyValue>>;
      children: Array<HastNode>;
    };

type MdNode = {
  type: string;
  value?: string;
  children?: Array<MdNode>;
  data?: {
    hName?: string;
    hChildren?: Array<HastNode>;
  };
  position?: { start: { offset?: number }; end: { offset?: number } };
};

const regexTokenElement = (source: string): HastNode => ({
  type: "element",
  tagName: REGEX_TOKEN_TAG,
  properties: {},
  children: [{ type: "text", value: source }],
});

const regexTokenNode = (source: string): MdNode => ({
  // Unknown mdast type; `mdast-util-to-hast` renders it from `data`, the same
  // route the synthesized math nodes above in `streamdown-plugins.tsx` take.
  type: "regexToken",
  data: {
    hName: REGEX_TOKEN_TAG,
    hChildren: [{ type: "text", value: source }],
  },
});

// Subtrees the walk must not descend into: block code goes through the Shiki
// decorator, math is already rewritten, and links keep their whole text
// clickable as a link. Deliberately NOT the same list as `PROTECTED_TYPES`
// below — this one gates *recursion* (so it carries block types like `code`
// and `definition`), and `inlineCode` is absent on purpose because it is
// rewritten by its own branch rather than skipped.
const SKIPPED_PARENTS = new Set([
  "code",
  "inlineMath",
  "math",
  "link",
  "linkReference",
  "image",
  "definition",
  "html",
]);

// Phrasing containers get a *source-level* rescan across all their children:
// a bare literal like `/a+(?:-b+)*$/` trips CommonMark's emphasis parsing on
// its `*`, so by node-walk time the literal is shredded across `text` and
// `emphasis` nodes and invisible to any per-node scan. Rebuilding from the
// container's raw source restores what the author actually wrote.
const PHRASING_CONTAINERS = new Set(["paragraph", "heading", "tableCell"]);

// Inline nodes a source-level candidate must never cross into: their content
// either has its own handling (inline code), or replacing it with plain text
// would break real structure (links, math, footnotes). Deliberately NOT the
// same list as `SKIPPED_PARENTS` above — this one masks *source spans* inside
// a phrasing container, so it is inline-only (no block `code`/`definition`)
// and does include `inlineCode`. Making the two lists match would break both.
const PROTECTED_TYPES = new Set([
  "inlineCode",
  "link",
  "linkReference",
  "image",
  "imageReference",
  "html",
  "inlineMath",
  "math",
  "footnoteReference",
]);

// A token's text is copied from the raw source so backslash escapes survive
// (`\.` must stay `\.`), but CommonMark resolves character references in
// prose (`&amp;` → `&`). A literal containing one would therefore render
// differently from the paragraph around it *and* compile a different pattern
// than it displays, so it is left alone — the same trade as the nested-markup
// check below. Code spans are exempt: CommonMark does not resolve references
// inside them, so their raw value is already what renders.
const CHARACTER_REFERENCE = /&(?:#\d+|#[xX][\dA-Fa-f]+|[A-Za-z][A-Za-z\d]*);/;

const isRewritable = (candidate: RegexCandidate): boolean =>
  !CHARACTER_REFERENCE.test(candidate.source);

/**
 * Splits one text node's *source* into plain-text and regex-token nodes.
 * Detection must see the source, not `value`: CommonMark resolves escapes
 * while parsing (`\.` becomes `.`), which would silently alter a pattern.
 */
const splitTextNode = (raw: string): Array<MdNode> | undefined => {
  const candidates = findRegexCandidates(raw).filter(isRewritable);

  if (candidates.length === 0) {
    return undefined;
  }

  return splitBySpans<RegexCandidate, MdNode>(
    raw,
    candidates,
    (slice) => ({ type: "text", value: decodeString(slice) }),
    (candidate) => regexTokenNode(candidate.source),
  );
};

/** Inline code keeps its `<code>` element; literals get wrapped inside it. */
const rewriteInlineCode = (node: MdNode): void => {
  const value = node.value ?? "";
  const candidates = findRegexCandidates(value);

  if (candidates.length === 0) {
    return;
  }

  node.data = {
    ...node.data,
    hName: "code",
    hChildren: splitBySpans<RegexCandidate, HastNode>(
      value,
      candidates,
      (slice) => ({ type: "text", value: slice }),
      (candidate) => regexTokenElement(candidate.source),
    ),
  };
};

interface Span {
  start: number;
  end: number;
}

const nodeSpan = (node: MdNode): Span | undefined => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { start, end };
};

/** First content offset, descending past wrapper delimiters (e.g. `*`). */
const innerStart = (node: MdNode): number | undefined =>
  node.children && node.children.length > 0
    ? innerStart(node.children[0])
    : nodeSpan(node)?.start;

/** Last content offset, descending past wrapper delimiters (e.g. `*`). */
const innerEnd = (node: MdNode): number | undefined => {
  const last = node.children?.at(-1);
  return last === undefined ? nodeSpan(node)?.end : innerEnd(last);
};

/** Source spans of every `text` descendant, in document order. */
const collectTextSpans = (node: MdNode, out: Array<Span>): void => {
  if (node.type === "text") {
    const span = nodeSpan(node);

    if (span) {
      out.push(span);
    }

    return;
  }

  for (const child of node.children ?? []) {
    collectTextSpans(child, out);
  }
};

/**
 * Whether every character in `[from, to)` came from a `text` node.
 *
 * Flattening a run re-emits the source around the literal as plain text, so
 * this is what makes that safe: any character in those slices that is *not*
 * from a text node is markup CommonMark already consumed — a nested `*`/`_`
 * pair, a `` ` `` — and re-emitting it would surface delimiters the author
 * never typed as literal ones while losing the structure they did.
 */
const isTextOnly = (
  from: number,
  to: number,
  textSpans: Array<Span>,
): boolean => {
  let cursor = from;

  for (const span of textSpans) {
    if (cursor >= to) {
      return true;
    }

    if (span.end <= cursor) {
      continue;
    }

    if (span.start > cursor) {
      return false;
    }

    cursor = span.end;
  }

  return cursor >= to;
};

/**
 * Collects the source spans of protected descendants, so a source-level
 * candidate overlapping any of them can be discarded. Returns `false` when a
 * protected descendant has no position (synthesized, e.g. by the math
 * rewrite) — its span is unknowable, so the source-level pass must not run.
 */
const collectProtectedSpans = (node: MdNode, out: Array<Span>): boolean => {
  for (const child of node.children ?? []) {
    if (PROTECTED_TYPES.has(child.type)) {
      const span = nodeSpan(child);

      if (!span) {
        return false;
      }

      out.push(span);
      continue;
    }

    if (!collectProtectedSpans(child, out)) {
      return false;
    }
  }

  return true;
};

/** Applies the inline-code rewrite to every `inlineCode` in the subtree. */
const rewriteInlineCodeDeep = (node: MdNode): void => {
  for (const child of node.children ?? []) {
    if (child.type === "inlineCode") {
      rewriteInlineCode(child);
    } else if (!PROTECTED_TYPES.has(child.type)) {
      rewriteInlineCodeDeep(child);
    }
  }
};

/**
 * Drains children off the front of `queue` that end at or before `boundary`,
 * moving each into `rebuilt` unchanged. Returns `false` when a child's
 * position is unknown — the whole source-level rewrite must then bail.
 */
function drainQueueBefore(
  queue: Array<MdNode>,
  rebuilt: Array<MdNode>,
  boundary: number,
): boolean {
  while (queue.length > 0) {
    const span = nodeSpan(queue[0]);

    if (!span) {
      return false;
    }

    if (span.end > boundary) {
      break;
    }

    // SAFETY: the enclosing `while (queue.length > 0)` just checked this,
    // so `shift()` cannot return undefined here.
    rebuilt.push(queue.shift() as MdNode);
  }

  return true;
}

type OverlappingRun = {
  run: Array<MdNode>;
  runStart?: number;
  runEnd?: number;
};

/**
 * Collects (and removes from `queue`) the run of children starting before
 * `boundary`. The kept prefix/suffix use the run's *inner* text bounds, not
 * the node bounds: a partially-overlapped emphasis node's source includes
 * its `*`/`_` delimiters (one of which may even be synthetic, appended by
 * remend to close the emphasis the literal itself opened mid-stream), and
 * those must not resurface as literal text. Returns `null` when a child's
 * position is unknown — the whole source-level rewrite must then bail.
 */
function collectOverlappingRun(
  queue: Array<MdNode>,
  boundary: number,
): OverlappingRun | null {
  const run: Array<MdNode> = [];
  let runStart: number | undefined;
  let runEnd: number | undefined;

  while (queue.length > 0) {
    const node = queue[0];
    const span = nodeSpan(node);
    const start = innerStart(node);
    const end = innerEnd(node);

    if (!span || start === undefined || end === undefined) {
      return null;
    }

    if (span.start >= boundary) {
      break;
    }

    runStart ??= start;
    runEnd = end;
    // SAFETY: the enclosing `while (queue.length > 0)` just checked this,
    // so `shift()` cannot return undefined here.
    run.push(queue.shift() as MdNode);
  }

  return { run, runStart, runEnd };
}

type FlattenRunArgs = {
  candidate: RegexCandidate;
  run: Array<MdNode>;
  runStart: number;
  runEnd: number;
  rebuilt: Array<MdNode>;
  queue: Array<MdNode>;
  source: string;
};

/**
 * Folds an overlapping run into surrounding text + a token when it's safe to
 * (the source around the literal is entirely text — see the inline
 * `isTextOnly` rationale), otherwise keeps the run's nodes untouched. Any
 * remainder after the candidate is requeued as a positioned text node so the
 * next candidate can re-split it.
 */
function flattenRun({
  candidate,
  run,
  runStart,
  runEnd,
  rebuilt,
  queue,
  source,
}: FlattenRunArgs): void {
  // Only flatten when the source we would re-emit around the literal is
  // entirely text. A run can hold markup the literal had nothing to do with
  // — `A /p*q/ mid *word*pair* end.` parses as one emphasis (opened by the
  // literal's own `*`) wrapping a second, nested one — and flattening that
  // would print the nested delimiters as literal asterisks while dropping
  // the outer closing one. Leaving the candidate alone costs an underline;
  // rewriting it would silently change what the message says.
  const textSpans: Array<Span> = [];

  for (const node of run) {
    collectTextSpans(node, textSpans);
  }

  if (
    !isTextOnly(runStart, candidate.start, textSpans) ||
    !isTextOnly(candidate.end, runEnd, textSpans)
  ) {
    rebuilt.push(...run);
    return;
  }

  if (runStart < candidate.start) {
    rebuilt.push({
      type: "text",
      value: decodeString(source.slice(runStart, candidate.start)),
    });
  }

  rebuilt.push(regexTokenNode(candidate.source));

  if (candidate.end < runEnd) {
    // The remainder may hold further candidates — requeue it as a
    // positioned text node so the next iteration re-splits it.
    queue.unshift({
      type: "text",
      value: decodeString(source.slice(candidate.end, runEnd)),
      position: {
        start: { offset: candidate.end },
        end: { offset: runEnd },
      },
    });
  }
}

/**
 * Applies one candidate to the queued children: drains the unaffected
 * prefix, collects the run it overlaps, and flattens that run when safe.
 * Returns `false` when a child's position is unknown, propagating the
 * source-level rewrite's bail-to-per-node-scan signal.
 */
function applyCandidateToQueue(
  candidate: RegexCandidate,
  queue: Array<MdNode>,
  rebuilt: Array<MdNode>,
  source: string,
): boolean {
  if (!drainQueueBefore(queue, rebuilt, candidate.start)) {
    return false;
  }

  const collected = collectOverlappingRun(queue, candidate.end);

  if (collected === null) {
    return false;
  }

  const { run, runStart, runEnd } = collected;

  if (run.length === 0 || runStart === undefined || runEnd === undefined) {
    return true;
  }

  flattenRun({ candidate, run, runStart, runEnd, rebuilt, queue, source });
  return true;
}

/**
 * Source-level rewrite of one phrasing container. Candidates come from the
 * container's raw source; each one replaces the run of children it overlaps
 * with plain text + a token. Flattening that run is intentional — when a
 * literal's `*`/`_` opened an emphasis node, that emphasis never existed in
 * the author's intent. Returns `false` when positions are missing and the
 * caller should fall back to per-node scanning.
 */
const rewritePhrasingFromSource = (node: MdNode, source: string): boolean => {
  const parentSpan = nodeSpan(node);

  if (!parentSpan) {
    return false;
  }

  const raw = source.slice(parentSpan.start, parentSpan.end);

  // No slash anywhere in this container (including its inline code) means no
  // candidate anywhere — skip both descendant walks below.
  if (!raw.includes("/")) {
    return true;
  }

  const protectedSpans: Array<Span> = [];

  if (!collectProtectedSpans(node, protectedSpans)) {
    return false;
  }
  const candidates = findRegexCandidates(raw)
    .filter(isRewritable)
    .map((candidate) => ({
      ...candidate,
      start: candidate.start + parentSpan.start,
      end: candidate.end + parentSpan.start,
    }))
    .filter(
      (candidate) =>
        !protectedSpans.some(
          (span) => candidate.start < span.end && candidate.end > span.start,
        ),
    );

  rewriteInlineCodeDeep(node);

  if (candidates.length === 0) {
    return true;
  }

  const queue = [...(node.children ?? [])];
  const rebuilt: Array<MdNode> = [];

  for (const candidate of candidates) {
    if (!applyCandidateToQueue(candidate, queue, rebuilt, source)) {
      return false;
    }
  }

  node.children = [...rebuilt, ...queue];
  return true;
};

/**
 * Per-node fallback for containers without reliable positions: text nodes
 * are scanned by their `value` (escapes already resolved — imperfect, but
 * positionless nodes give nothing better).
 */
const rewriteChildrenByValue = (node: MdNode): void => {
  const children = node.children;

  if (!children) {
    return;
  }

  const rewritten: Array<MdNode> = [];
  let changed = false;

  for (const child of children) {
    if (SKIPPED_PARENTS.has(child.type)) {
      rewritten.push(child);
      continue;
    }

    if (child.type === "inlineCode") {
      rewriteInlineCode(child);
      rewritten.push(child);
      continue;
    }

    if (child.type === "text") {
      const value = child.value ?? "";
      const split = value.includes("/") ? splitTextNode(value) : undefined;

      if (split) {
        rewritten.push(...split);
        changed = true;
      } else {
        rewritten.push(child);
      }

      continue;
    }

    rewriteChildrenByValue(child);
    rewritten.push(child);
  }

  if (changed) {
    node.children = rewritten;
  }
};

const rewriteRegexNodes = (node: MdNode, source: string): void => {
  if (PHRASING_CONTAINERS.has(node.type)) {
    if (!rewritePhrasingFromSource(node, source)) {
      rewriteChildrenByValue(node);
    }
    return;
  }

  for (const child of node.children ?? []) {
    if (!SKIPPED_PARENTS.has(child.type)) {
      rewriteRegexNodes(child, source);
    }
  }
};

function hasStringValue(file: { value: unknown }): file is { value: string } {
  return typeof file.value === "string";
}

/**
 * Remark plugin: underlines regex literals in prose and inline code by
 * wrapping them in `<regex-token>` elements. Appended via Streamdown's
 * `remarkPlugins`, so it runs after GFM and the math rewrite.
 */
export const remarkRegexTokens =
  () => (tree: MdNode, file: { value: unknown }) => {
    if (hasStringValue(file) && file.value.includes("/")) {
      rewriteRegexNodes(tree, file.value);
    }
  };

// Subtrees the hast pass must not touch. `pre` is the code-block path (the
// Shiki wrapper below owns it) and `script`/`style`/`textarea` hold raw text
// that is not prose. The rest are interactive: the token renders as a
// `role="button"`, and nesting that inside a control is both an axe
// `nested-interactive` violation and a real conflict — activating a token
// inside a `summary` would toggle the disclosure. Attributes and comments are
// safe by construction: this pass only ever splits `text` nodes.
const HAST_SKIPPED_TAGS = new Set([
  "pre",
  "script",
  "style",
  "textarea",
  "a",
  "button",
  "summary",
  "label",
  "select",
  "option",
  REGEX_TOKEN_TAG,
]);

const rewriteHastNode = (node: HastNode): void => {
  if (node.type === "text") {
    return;
  }

  const children = node.children;
  const rewritten: Array<HastNode> = [];
  let changed = false;

  for (const child of children) {
    if (child.type === "text") {
      const candidates = child.value.includes("/")
        ? findRegexCandidates(child.value)
        : [];

      if (candidates.length === 0) {
        rewritten.push(child);
        continue;
      }

      rewritten.push(
        ...splitBySpans<RegexCandidate, HastNode>(
          child.value,
          candidates,
          (slice) => ({ type: "text", value: slice }),
          (candidate) => regexTokenElement(candidate.source),
        ),
      );
      changed = true;
      continue;
    }

    if (child.type === "element" && HAST_SKIPPED_TAGS.has(child.tagName)) {
      rewritten.push(child);
      continue;
    }

    rewriteHastNode(child);
    rewritten.push(child);
  }

  if (changed) {
    node.children = rewritten;
  }
};

/**
 * Rehype pass: wraps regex literals in the *rendered* text.
 *
 * The remark pass above only sees markdown-derived nodes, so a literal inside
 * a raw HTML block (`<section>`, `<details>`, `<td>`, …) never reached it —
 * those arrive as one opaque `html` node and are skipped. By hast time
 * `rehype-raw` has parsed them into ordinary elements, so one walk covers
 * markdown and HTML alike.
 *
 * Wrapping here cannot alter a message: it splits a text node and re-inserts
 * exactly the characters it removed. That also makes it the safe net for
 * literals the source-level pass deliberately declines, and it means the
 * token tests precisely what the reader sees.
 *
 * Runs *after* `rehype-sanitize`, so the element it inserts is not stripped.
 * That is only sound because this pass never introduces attributes, never
 * parses markup, and never copies text across nodes — it must stay that way.
 */
export const rehypeRegexTokens = () => (tree: HastNode) => {
  rewriteHastNode(tree);
};
