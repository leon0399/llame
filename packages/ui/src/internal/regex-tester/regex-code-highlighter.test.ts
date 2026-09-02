import type { PluginConfig } from "streamdown";
import { describe, expect, it } from "vitest";

import { withRegexTokens } from "./regex-code-highlighter.js";

type CodeHighlighter = NonNullable<PluginConfig["code"]>;
type HighlightResult = NonNullable<ReturnType<CodeHighlighter["highlight"]>>;

// SAFETY: `language` and `themes` are valid BundledLanguage/theme-pair
// members; the cast only narrows past inference widening the literal
// `"typescript"` to `string` and the two-theme array to `string[]`.
const options = {
  code: "",
  language: "typescript",
  themes: ["github-light", "github-dark"],
} as Parameters<CodeHighlighter["highlight"]>[0];

const baseHighlighter = (
  highlight: CodeHighlighter["highlight"],
): CodeHighlighter => ({
  name: "shiki",
  type: "code-highlighter",
  getSupportedLanguages: () => [],
  getThemes: () => ["github-light", "github-dark"],
  supportsLanguage: () => true,
  highlight,
});

const result = (tokens: HighlightResult["tokens"]): HighlightResult => ({
  tokens,
});

describe("withRegexTokens", () => {
  it("decorates an immediate highlight while preserving styles and classes", () => {
    const highlighted = result([
      [
        {
          content: "const value = /\\d",
          offset: 0,
          htmlAttrs: { class: "token keyword" },
          htmlStyle: { color: "red", background: "black" },
        },
        {
          content: "+/g;",
          offset: 18,
          htmlAttrs: { class: "token punctuation" },
          htmlStyle: { color: "blue" },
        },
      ],
    ]);
    const base = baseHighlighter(() => highlighted);
    const decorated = withRegexTokens(base);

    const actual = decorated.highlight(options);

    expect(actual).not.toBeNull();
    const marked = actual?.tokens[0].filter(
      (token) => token.htmlAttrs?.["data-regex-token"],
    );
    expect(marked?.map((token) => token.content).join("")).toBe(
      String.raw`/\d+/g`,
    );
    expect(marked).toHaveLength(2);
    expect(
      marked?.every(
        (token) => token.htmlAttrs?.["data-regex-token"] === String.raw`/\d+/g`,
      ),
    ).toBe(true);
    expect(marked?.[0]).toMatchObject({
      htmlAttrs: {
        class: "token keyword",
        "data-regex-token": String.raw`/\d+/g`,
      },
      htmlStyle: {
        color: "red",
        background: "black",
        "text-decoration-line": "underline",
        "text-decoration-style": "dotted",
        "text-decoration-thickness": "1px",
        "text-underline-offset": "3px",
        cursor: "pointer",
      },
      offset: 14,
    });
    expect(marked?.[1]).toMatchObject({
      htmlAttrs: {
        class: "token punctuation",
        "data-regex-token": String.raw`/\d+/g`,
      },
      htmlStyle: { color: "blue" },
      offset: 18,
    });
    expect(actual?.tokens[0].map((token) => token.content).join("")).toBe(
      String.raw`const value = /\d+/g;`,
    );
  });

  it("decorates a highlight delivered through the asynchronous callback", () => {
    const highlighted = result([[{ content: "const id = /\\d+/;" }]]);
    let callbackResult: HighlightResult | undefined;
    const base = baseHighlighter((_options, callback) => {
      callback?.(highlighted);
      return null;
    });
    const decorated = withRegexTokens(base);

    const actual = decorated.highlight(options, (value) => {
      callbackResult = value;
    });

    expect(actual).toBeNull();
    expect(callbackResult?.tokens[0][0]).toMatchObject({
      content: "const id = ",
    });
    expect(callbackResult?.tokens[0][1]).toMatchObject({
      content: "/\\d+/",
      htmlAttrs: { "data-regex-token": String.raw`/\d+/` },
    });
  });

  it("returns the original result and token identities when no literal is found", () => {
    const plain = result([[{ content: "const ratio = width / height;" }]]);
    const base = baseHighlighter(() => plain);
    const decorated = withRegexTokens(base);

    const actual = decorated.highlight(options);

    expect(actual).toBe(plain);
    expect(actual?.tokens[0][0]).toBe(plain.tokens[0][0]);
    expect(actual?.tokens[0][0].htmlAttrs).toBeUndefined();
  });
});
