import { describe, expect, it } from "vitest";

import {
  rehypeRegexTokens,
  remarkRegexTokens,
  regexTokenAllowedTags,
} from "./regex-markdown.js";
import { REGEX_TOKEN_TAG } from "./regex-token.js";

type MdNode = {
  type: string;
  value?: string;
  children?: Array<MdNode>;
  data?: { hName?: string; hChildren?: Array<HastNode> };
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/** hast attribute value shapes (hast-util-to-jsx-runtime's `Properties` contract). */
type HastPropertyValue = boolean | number | string;

type HastNode =
  | { type: "text"; value: string }
  | {
      type: "element";
      tagName: string;
      properties: Record<string, HastPropertyValue | Array<HastPropertyValue>>;
      children: Array<HastNode>;
    };

const positioned = (type: string, value: string, start = 0): MdNode => ({
  type,
  value,
  position: {
    start: { offset: start },
    end: { offset: start + value.length },
  },
});

const paragraph = (source: string, children: Array<MdNode>): MdNode => ({
  type: "root",
  children: [
    {
      type: "paragraph",
      position: { start: { offset: 0 }, end: { offset: source.length } },
      children,
    },
  ],
});

const applyRemark = (tree: MdNode, source: string) => {
  remarkRegexTokens()(tree, { value: source });
};

const tokenSources = (node: MdNode): Array<string> =>
  (node.children ?? []).flatMap((child) =>
    child.type === "regexToken"
      ? [
          child.data?.hChildren?.[0]?.type === "text"
            ? child.data.hChildren[0].value
            : "",
        ]
      : tokenSources(child),
  );

describe("remarkRegexTokens", () => {
  it("wraps prose literals while preserving surrounding markdown text", () => {
    const source = String.raw`Use /^\d+$/ before saving.`;
    const tree = paragraph(source, [positioned("text", source)]);

    applyRemark(tree, source);

    expect(tokenSources(tree)).toEqual([String.raw`/^\d+$/`]);
    expect(tree.children?.[0].children?.map((child) => child.type)).toEqual([
      "text",
      "regexToken",
      "text",
    ]);
  });

  it("wraps inline-code literals without replacing the code element", () => {
    const source = "Use `/\\d+\\.\\d+/` here.";
    const codeStart = source.indexOf("`");
    const codeValue = String.raw`/\d+\.\d+/`;
    const tree = paragraph(source, [
      positioned("text", "Use "),
      {
        type: "inlineCode",
        value: codeValue,
        position: {
          start: { offset: codeStart },
          end: { offset: codeStart + codeValue.length + 2 },
        },
      },
      positioned("text", " here.", source.length - 6),
    ]);

    applyRemark(tree, source);

    const inlineCode = tree.children?.[0].children?.[1];
    expect(inlineCode?.type).toBe("inlineCode");
    expect(inlineCode?.data).toMatchObject({ hName: "code" });
    expect(inlineCode?.data?.hChildren).toEqual([
      {
        type: "element",
        tagName: REGEX_TOKEN_TAG,
        properties: {},
        children: [{ type: "text", value: codeValue }],
      },
    ]);
  });

  it("leaves fenced-code subtrees for the code-highlighter adapter", () => {
    const source = String.raw`const pattern = /^\d+$/;`;
    const code = {
      type: "code",
      value: source,
      position: { start: { offset: 0 }, end: { offset: source.length } },
      children: [],
    } satisfies MdNode;
    const tree: MdNode = { type: "root", children: [code] };

    applyRemark(tree, source);

    expect(tokenSources(tree)).toEqual([]);
    expect(tree.children?.[0]).toBe(code);
  });

  it("rejects invalid and escaped source literals", () => {
    for (const source of [
      "Broken /(unclosed/ literal.",
      String.raw`Escaped \/\d+\/ stays plain.`,
    ]) {
      const tree = paragraph(source, [positioned("text", source)]);
      applyRemark(tree, source);
      expect(tokenSources(tree)).toEqual([]);
    }
  });
});

describe("rehypeRegexTokens", () => {
  it("wraps rendered text from raw HTML while leaving attributes and raw-text nodes alone", () => {
    const tree: HastNode = {
      type: "element",
      tagName: "section",
      properties: { "data-pattern": String.raw`/^\d+$/` },
      children: [
        { type: "text", value: "Rendered /^\\d+$/ text." },
        {
          type: "element",
          tagName: "script",
          properties: {},
          children: [{ type: "text", value: "const x = /^\\d+$/;" }],
        },
      ],
    };

    rehypeRegexTokens()(tree);

    expect(tree.children[0]).toMatchObject({
      type: "text",
      value: "Rendered ",
    });
    expect(tree.children[1]).toMatchObject({
      type: "element",
      tagName: REGEX_TOKEN_TAG,
      properties: {},
      children: [{ type: "text", value: "/^\\d+$/" }],
    });
    expect(tree.children[2]).toMatchObject({
      type: "text",
      value: " text.",
    });
    // SAFETY: children[3] is the `script` element constructed in the fixture
    // above (the fourth child), so narrowing to the element variant is sound
    // by construction.
    expect(
      (tree.children[3] as Extract<HastNode, { type: "element" }>).children,
    ).toEqual([{ type: "text", value: "const x = /^\\d+$/;" }]);
    expect(tree.properties).toEqual({ "data-pattern": String.raw`/^\d+$/` });
  });

  it("does not trust a pre-sanitized model-authored token element", () => {
    const tree: HastNode = {
      type: "element",
      tagName: "p",
      properties: {},
      children: [
        {
          type: "element",
          tagName: REGEX_TOKEN_TAG,
          properties: { onclick: "alert(1)" },
          children: [{ type: "text", value: "/^\\d+$/" }],
        },
      ],
    };

    rehypeRegexTokens()(tree);

    expect(tree.children).toEqual([
      {
        type: "element",
        tagName: REGEX_TOKEN_TAG,
        properties: { onclick: "alert(1)" },
        children: [{ type: "text", value: "/^\\d+$/" }],
      },
    ]);
    expect(regexTokenAllowedTags).toEqual({ [REGEX_TOKEN_TAG]: [] });
  });
});
