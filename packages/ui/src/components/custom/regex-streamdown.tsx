import type { PluginConfig } from "streamdown";

import {
  findRegexCandidates,
  splitBySpans,
  type RegexCandidate,
} from "@workspace/ui/lib/regex-detect";
import { decodeString } from "micromark-util-decode-string";

/**
 * Streamdown-side wiring for the message regex tester: a remark rewrite that
 * wraps regex literals in prose and inline code with `<regex-token>` elements,
 * and a decorator for the Shiki code plugin that underlines literals inside
 * fenced code blocks. The interactive layer lives in `regex-tester.tsx`; both
 * surfaces communicate with it only through the `data-regex-token` attribute.
 */

export const REGEX_TOKEN_TAG = "regex-token";

/**
 * Full-viewport overlays Streamdown portals to `<body>` (table and mermaid
 * fullscreen render as `fixed inset-0 z-50`). A popover portaled to `<body>`
 * ties their z-index and loses on DOM order, so one anchored inside such an
 * overlay has to portal into the overlay itself. `dialog`/`aria-modal` cover
 * other modal hosts the same way.
 *
 * `data-streamdown="table-fullscreen"` is an unexported Streamdown internal —
 * it lives here with the rest of this file's Streamdown-internals knowledge,
 * not in `regex-tester.tsx`, which stays renderer-agnostic. The fullscreen
 * regression story is what keeps it honest across upgrades.
 */
export const OVERLAY_SELECTOR =
  '[data-streamdown="table-fullscreen"], [aria-modal="true"], dialog';

/** `allowedTags` entry that lets `<regex-token>` survive rehype-sanitize. */
export const regexTokenAllowedTags = { [REGEX_TOKEN_TAG]: [] as string[] };

type HastNode =
  | { type: "text"; value: string }
  | {
      type: "element";
      tagName: string;
      properties: Record<string, unknown>;
      children: HastNode[];
    };

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: {
    hName?: string;
    hChildren?: HastNode[];
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

/**
 * Splits one text node's *source* into plain-text and regex-token nodes.
 * Detection must see the source, not `value`: CommonMark resolves escapes
 * while parsing (`\.` becomes `.`), which would silently alter a pattern.
 */
const splitTextNode = (raw: string): MdNode[] | undefined => {
  const candidates = findRegexCandidates(raw);

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
  const children = node.children;
  return children && children.length > 0
    ? innerEnd(children[children.length - 1])
    : nodeSpan(node)?.end;
};

/** Source spans of every `text` descendant, in document order. */
const collectTextSpans = (node: MdNode, out: Span[]): void => {
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
const isTextOnly = (from: number, to: number, textSpans: Span[]): boolean => {
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
const collectProtectedSpans = (node: MdNode, out: Span[]): boolean => {
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

  const protectedSpans: Span[] = [];

  if (!collectProtectedSpans(node, protectedSpans)) {
    return false;
  }
  const candidates = findRegexCandidates(raw)
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
  const rebuilt: MdNode[] = [];

  for (const candidate of candidates) {
    // Keep children that end before the candidate starts.
    while (queue.length > 0) {
      const span = nodeSpan(queue[0]);

      if (!span) {
        return false;
      }

      if (span.end > candidate.start) {
        break;
      }

      rebuilt.push(queue.shift() as MdNode);
    }

    // Collect the run of children the candidate overlaps. The kept
    // prefix/suffix use the run's *inner* text bounds, not the node bounds:
    // a partially-overlapped emphasis node's source includes its `*`/`_`
    // delimiters (one of which may even be synthetic, appended by remend to
    // close the emphasis the literal itself opened mid-stream), and those
    // must not resurface as literal text.
    const run: MdNode[] = [];
    let runStart: number | undefined;
    let runEnd: number | undefined;

    while (queue.length > 0) {
      const node = queue[0];
      const span = nodeSpan(node);
      const start = innerStart(node);
      const end = innerEnd(node);

      if (!span || start === undefined || end === undefined) {
        return false;
      }

      if (span.start >= candidate.end) {
        break;
      }

      runStart ??= start;
      runEnd = end;
      run.push(queue.shift() as MdNode);
    }

    if (run.length === 0 || runStart === undefined || runEnd === undefined) {
      continue;
    }

    // Only flatten when the source we would re-emit around the literal is
    // entirely text. A run can hold markup the literal had nothing to do with
    // — `A /p*q/ mid *word*pair* end.` parses as one emphasis (opened by the
    // literal's own `*`) wrapping a second, nested one — and flattening that
    // would print the nested delimiters as literal asterisks while dropping
    // the outer closing one. Leaving the candidate alone costs an underline;
    // rewriting it would silently change what the message says.
    const textSpans: Span[] = [];

    for (const node of run) {
      collectTextSpans(node, textSpans);
    }

    if (
      !isTextOnly(runStart, candidate.start, textSpans) ||
      !isTextOnly(candidate.end, runEnd, textSpans)
    ) {
      rebuilt.push(...run);
      continue;
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

  const rewritten: MdNode[] = [];
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

/**
 * Remark plugin: underlines regex literals in prose and inline code by
 * wrapping them in `<regex-token>` elements. Appended via Streamdown's
 * `remarkPlugins`, so it runs after GFM and the math rewrite.
 */
export const remarkRegexTokens =
  () => (tree: MdNode, file: { value: unknown }) => {
    if (typeof file.value === "string" && file.value.includes("/")) {
      rewriteRegexNodes(tree, file.value);
    }
  };

type CodeHighlighterPlugin = NonNullable<PluginConfig["code"]>;
type HighlightResult = NonNullable<
  ReturnType<CodeHighlighterPlugin["highlight"]>
>;
type ThemedToken = HighlightResult["tokens"][number][number];

const underlineStyle = {
  "text-decoration-line": "underline",
  "text-decoration-style": "dotted",
  "text-decoration-thickness": "1px",
  "text-underline-offset": "3px",
  cursor: "pointer",
} as const;

const shiftedOffset = (token: ThemedToken, offsetShift: number) =>
  typeof token.offset === "number"
    ? { offset: token.offset + offsetShift }
    : null;

/** Narrows a token to `content`, keeping its identity when nothing changed. */
const sliceToken = (
  token: ThemedToken,
  content: string,
  offsetShift: number,
): ThemedToken =>
  content === token.content
    ? token
    : { ...token, content, ...shiftedOffset(token, offsetShift) };

const decorateToken = (
  token: ThemedToken,
  content: string,
  offsetShift: number,
  candidate: RegexCandidate,
): ThemedToken => ({
  ...sliceToken(token, content, offsetShift),
  // Streamdown's token renderer folds `htmlStyle` into the span's style and
  // spreads `htmlAttrs` onto it — the only pass-through the tokens offer.
  htmlStyle: {
    ...(typeof token.htmlStyle === "object" ? token.htmlStyle : undefined),
    ...underlineStyle,
  },
  htmlAttrs: { ...token.htmlAttrs, "data-regex-token": candidate.source },
});

const decorateLine = (
  line: ThemedToken[],
  candidates: RegexCandidate[],
): ThemedToken[] => {
  const out: ThemedToken[] = [];
  let pos = 0;

  for (const token of line) {
    const end = pos + token.content.length;

    // Most tokens on a line that holds a literal are nowhere near it; leaving
    // them whole skips building a cut set and sorting it per token.
    if (!candidates.some((entry) => entry.start < end && entry.end > pos)) {
      out.push(token);
      pos = end;
      continue;
    }

    const cuts = new Set([pos, end]);

    for (const candidate of candidates) {
      if (candidate.start > pos && candidate.start < end) {
        cuts.add(candidate.start);
      }
      if (candidate.end > pos && candidate.end < end) {
        cuts.add(candidate.end);
      }
    }

    const bounds = [...cuts].sort((a, b) => a - b);

    for (let i = 0; i < bounds.length - 1; i += 1) {
      const [from, to] = [bounds[i], bounds[i + 1]];
      const content = token.content.slice(from - pos, to - pos);
      const candidate = candidates.find(
        (entry) => from >= entry.start && to <= entry.end,
      );

      out.push(
        candidate
          ? decorateToken(token, content, from - pos, candidate)
          : sliceToken(token, content, from - pos),
      );
    }

    pos = end;
  }

  return out;
};

const decorateResult = (result: HighlightResult): HighlightResult => {
  let changed = false;

  const tokens = result.tokens.map((line) => {
    // The cheapest possible "does this line even apply" test — it runs for
    // every line of every code block on every highlight, so it must not
    // rebuild the line's text just to look for a slash.
    if (!line.some((token) => token.content.includes("/"))) {
      return line;
    }

    const candidates = findRegexCandidates(
      line.map((token) => token.content).join(""),
    );

    if (candidates.length === 0) {
      return line;
    }

    changed = true;
    return decorateLine(line, candidates);
  });

  return changed ? { ...result, tokens } : result;
};

/**
 * Wraps the `@streamdown/code` Shiki plugin so highlighted lines get their
 * regex literals split out and marked with `data-regex-token` + a dotted
 * underline, keeping each token's own syntax color.
 */
export const withRegexTokens = (
  base: CodeHighlighterPlugin,
): CodeHighlighterPlugin => ({
  ...base,
  highlight: (options, callback) => {
    const result = base.highlight(
      options,
      callback ? (async_) => callback(decorateResult(async_)) : undefined,
    );

    return result ? decorateResult(result) : result;
  },
});
