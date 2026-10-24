"use client";

import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useState,
} from "react";
import {
  type BundledLanguage,
  bundledLanguages,
  codeToTokens,
  type ThemedToken,
} from "shiki";

import { ScrollRegion } from "@workspace/ui/components/custom/scroll-region";
import { cn } from "@workspace/ui/lib/utils";

/** One displayed source line: its 1-based number in the source, or `null`
 *  for a line the tool did not number, and its text without the prefix. */
export type SourceLine = { number: number | null; text: string };

// The tools render every numbered line as `${n}: ${text}`
// (packages/native-file-tools source-lines.ts). `s` keeps a CRLF line's `\r`
// inside the text instead of failing the match.
const numberedLinePattern = /^(\d+): (.*)$/su;

function splitLines(content: string): Array<string> {
  // A final newline ends the last line rather than opening an empty one.
  const body = content.endsWith("\n") ? content.slice(0, -1) : content;
  return body === "" ? [] : body.split("\n");
}

/**
 * Splits a tool's numbered content (`read`, `edit`, `write`, `grep`,
 * `conversation_read`) into lines with the `N: ` prefix moved into
 * `number`, so the number renders in a gutter and never enters a copied
 * selection. A line without the prefix keeps `number: null`.
 */
export function parseNumberedLines(content: string): Array<SourceLine> {
  return splitLines(content).map((line) => {
    const match = numberedLinePattern.exec(line);
    return match
      ? { number: Number(match[1]), text: match[2] ?? "" }
      : { number: null, text: line };
  });
}

/** Numbers unprefixed text consecutively from `start`, e.g. the content a
 *  `write` call submitted. */
export function numberLines(text: string, start = 1): Array<SourceLine> {
  return splitLines(text).map((line, index) => ({
    number: start + index,
    text: line,
  }));
}

/**
 * The Shiki grammar for a path's file extension or bare file name
 * (`Dockerfile`), or `undefined` when Shiki bundles none. A trailing `read`
 * selector (`main.ts:3-4`) is ignored.
 */
export function languageForPath(path: string): BundledLanguage | undefined {
  const name = (path.split("/").at(-1) ?? "").toLowerCase();
  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1)
    : name;
  const candidate = extension.split(":")[0] ?? "";
  // SAFETY: `Object.hasOwn` just confirmed `candidate` is a key of
  // `bundledLanguages`, whose keys are exactly `BundledLanguage`.
  return Object.hasOwn(bundledLanguages, candidate)
    ? (candidate as BundledLanguage)
    : undefined;
}

type HighlightState = {
  code: string;
  language: BundledLanguage;
  tokens: Array<Array<ThemedToken>>;
};

/** Dual-theme tokens for `code`, or `null` before they resolve, without a
 *  grammar, or when highlighting fails; the caller then shows plain text. */
function useHighlightedTokens(
  code: string,
  language: BundledLanguage | undefined,
): Array<Array<ThemedToken>> | null {
  const [state, setState] = useState<HighlightState | null>(null);
  useEffect(() => {
    if (language === undefined) return;
    // Ignore a stale result that resolves after `code` changed.
    let active = true;
    codeToTokens(code, {
      lang: language,
      // High-contrast palettes keep every token at WCAG AA on the muted
      // panel; the transcript's one-light/one-dark-pro code blocks do not.
      themes: {
        light: "github-light-high-contrast",
        dark: "github-dark-high-contrast",
      },
    }).then(
      ({ tokens }) => {
        if (active) setState({ code, language, tokens });
      },
      () => {
        if (active) setState(null);
      },
    );
    return () => {
      active = false;
    };
  }, [code, language]);
  return state?.code === code && state.language === language
    ? state.tokens
    : null;
}

export type SourceLinesProps = {
  /** The lines to show, in order. A jump between consecutive numbers renders
   *  a gap marker, so non-adjacent ranges never read as contiguous. */
  lines: ReadonlyArray<SourceLine>;
  /** Accessible name of the height-capped scroll region. */
  label: string;
  /** Shiki grammar for syntax highlighting; plain text when absent. */
  language?: BundledLanguage;
  /** Source line numbers to emphasize, e.g. a search's matching lines. */
  emphasized?: ReadonlySet<number>;
};

function SourceToken({ token }: { token: ThemedToken }) {
  return (
    <span
      className="text-(--token-light) dark:text-(--token-dark)"
      style={
        // SAFETY: `--token-*` are CSS custom properties the `text-(--token-*)`
        // classes read; valid inline style keys at runtime that
        // CSSProperties's type doesn't model, so this asserts past that gap.
        {
          "--token-light": token.htmlStyle?.color,
          "--token-dark": token.htmlStyle?.["--shiki-dark"],
        } as CSSProperties
      }
    >
      {token.content}
    </span>
  );
}

function SourceLineText({
  line,
  tokens,
  emphasized,
}: {
  line: SourceLine;
  tokens: ReadonlyArray<ThemedToken> | undefined;
  emphasized: boolean;
}) {
  return (
    <div
      className={cn("flex", emphasized && "bg-foreground/10 font-medium")}
      data-line={line.number ?? undefined}
    >
      <span
        aria-hidden="true"
        className={cn(
          "w-(--gutter) shrink-0 select-none pr-3 pl-3 text-right tabular-nums",
          // Slate fails contrast on the emphasis fill.
          emphasized ? "text-foreground/70" : "text-muted-foreground",
        )}
      >
        {line.number}
      </span>
      {/* min-h keeps an empty line one line tall. */}
      <span className="min-h-[1lh] min-w-0 flex-1 whitespace-pre-wrap break-words pr-3">
        {tokens
          ? tokens.map((token) => (
              <SourceToken key={token.offset} token={token} />
            ))
          : line.text}
      </span>
    </div>
  );
}

/** One line, after a gap marker when its number does not follow the
 *  previous line's. */
function SourceLineRow({
  previous,
  ...props
}: {
  line: SourceLine;
  previous: SourceLine | undefined;
  tokens: ReadonlyArray<ThemedToken> | undefined;
  emphasized: boolean;
}) {
  const { number } = props.line;
  const gap =
    number !== null &&
    previous?.number !== undefined &&
    previous.number !== null &&
    number !== previous.number + 1;
  return (
    <>
      {gap ? (
        <div
          aria-hidden="true"
          className="w-(--gutter) select-none pr-3 text-right text-muted-foreground"
        >
          ⋯
        </div>
      ) : null}
      <SourceLineText {...props} />
    </>
  );
}

/**
 * Source text with its real line numbers in a non-selectable gutter, wrapped
 * long lines, and optional Shiki highlighting in both themes. Height-capped
 * through `ScrollRegion` so a large result cannot inflate the transcript.
 *
 * @summary for numbered file content in a tool result
 */
export function SourceLines({
  lines,
  label,
  language,
  emphasized,
}: SourceLinesProps): ReactElement {
  const tokens = useHighlightedTokens(
    lines.map((line) => line.text).join("\n"),
    language,
  );
  const highlighted = tokens?.length === lines.length ? tokens : null;
  const gutterWidth = Math.max(
    1,
    ...lines.map((line) => String(line.number ?? "").length),
  );
  return (
    <ScrollRegion label={label} className="rounded-md bg-muted/50">
      <div
        className="py-2 font-mono text-xs"
        // SAFETY: `--gutter` is a CSS custom property the gutter's
        // `w-(--gutter)` class reads; CSSProperties's type doesn't model it.
        style={{ "--gutter": `${gutterWidth + 4}ch` } as CSSProperties}
      >
        {lines.map((line, index) => (
          <SourceLineRow
            // Lines have no identity beyond their position.
            key={index}
            line={line}
            previous={lines[index - 1]}
            tokens={highlighted?.[index]}
            emphasized={
              line.number !== null && emphasized?.has(line.number) === true
            }
          />
        ))}
      </div>
    </ScrollRegion>
  );
}
