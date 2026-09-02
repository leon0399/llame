import type { PluginConfig } from "streamdown";

import {
  findRegexCandidates,
  type RegexCandidate,
} from "@workspace/ui/lib/regex-detect";
import { REGEX_TOKEN_ATTRIBUTE } from "#regex-tester/token";

export type CodeHighlighterPlugin = NonNullable<PluginConfig["code"]>;
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
  token.offset !== undefined ? { offset: token.offset + offsetShift } : null;

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
    ...token.htmlStyle,
    ...underlineStyle,
  },
  htmlAttrs: {
    ...token.htmlAttrs,
    [REGEX_TOKEN_ATTRIBUTE]: candidate.source,
  },
});

const decorateLine = (
  line: Array<ThemedToken>,
  candidates: Array<RegexCandidate>,
): Array<ThemedToken> => {
  const out: Array<ThemedToken> = [];
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
 * Wraps the `@streamdown/code` highlighter so highlighted lines get their
 * regex literals split out and marked with the shared token attribute and a
 * dotted underline, keeping each token's own syntax color.
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
