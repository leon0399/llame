import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { createMermaidPlugin, type MermaidConfig } from "@streamdown/mermaid";
import { decodeString } from "micromark-util-decode-string";
import type { PluginConfig } from "streamdown";

// `@streamdown/math`'s packaged `math` export hardcodes
// `singleDollarTextMath: false`, so `$x$` stays literal text and only `$$x$$`
// renders. Models (and people) overwhelmingly write inline math with single
// dollars, so enable it — and pair it with the currency guard below, since
// `remark-math` on its own reads "between $5 and $10" as math.
const mathPlugin = createMathPlugin({ singleDollarTextMath: true });

type MathNode = {
  type: string;
  value?: string;
  children?: Array<MathNode>;
  data?: {
    hName: string;
    hProperties?: { className: Array<string> };
    hChildren: Array<unknown>;
  };
  wasDisplayDelimited?: boolean;
  position?: { start: { offset?: number }; end: { offset?: number } };
};

// `\(…\)` and `\[…\]`, the delimiters several providers emit instead of
// dollars. The lookbehinds keep an escaped backslash from being read as a
// delimiter, so prose that shows `\\(x\\)` as literal LaTeX stays literal.
const latexDelimiters =
  /(?<!\\)\\(?:\(([\s\S]+?)(?<!\\)\\\)|\[([\s\S]+?)(?<!\\)\\\])/g;

// `mdast-util-math` carries no hast handler — it attaches the target element
// to `data` while parsing, and a synthesized node has to be built the same
// way to reach KaTeX. The class has to be `language-math` specifically:
// `rehype-sanitize` runs before `rehype-katex` in Streamdown's pipeline and
// only whitelists `/^language-./` on a `code` element, so the `math-inline` /
// `math-display` classes are gone by the time KaTeX looks. What survives is
// the structure — `code` alone is inline, `pre > code` is display.
const mathCodeElement = (value: string, isDisplay: boolean) => ({
  type: "element",
  tagName: "code",
  properties: {
    className: ["language-math", isDisplay ? "math-display" : "math-inline"],
  },
  children: [{ type: "text", value }],
});

const inlineMathNode = (value: string, isDisplay: boolean): MathNode => ({
  type: "inlineMath",
  value,
  // Our own marker, read only by the paragraph promotion below; mdast ignores
  // unknown fields and it never reaches the DOM.
  wasDisplayDelimited: isDisplay,
  data: {
    hName: "code",
    hProperties: mathCodeElement(value, isDisplay).properties,
    hChildren: [{ type: "text", value }],
  },
});

/** A whole paragraph that is nothing but `\[…\]` becomes real display math. */
const displayMathNode = (value: string): MathNode => ({
  type: "math",
  value,
  children: [],
  data: { hName: "pre", hChildren: [mathCodeElement(value, true)] },
});

/**
 * Expands `\(…\)` / `\[…\]` inside one text node's original source.
 *
 * The rewrite has to see the *source*, because CommonMark treats `\(` as an
 * escaped literal paren and drops the backslash while parsing — by the time a
 * node exists, the delimiter is already gone from its `value`. Working from
 * `position` offsets keeps that source access without re-lexing the document:
 * code spans and fenced blocks are never `text` nodes, whatever length their
 * delimiter runs are, and a text node never spans a paragraph break.
 *
 * Returns `undefined` when the node holds no delimiters and should be left as
 * it is — including a delimiter still waiting for its closing half mid-stream.
 */
const expandLatexDelimiters = (raw: string): Array<MathNode> | undefined => {
  if (!raw.includes(String.raw`\(`) && !raw.includes(String.raw`\[`)) {
    return undefined;
  }

  const matches = [...raw.matchAll(latexDelimiters)];

  if (matches.length === 0) {
    return undefined;
  }

  const nodes: Array<MathNode> = [];
  let cursor = 0;

  const pushText = (slice: string) => {
    if (slice) {
      // The slice is raw source; `decodeString` applies the character escapes
      // and references CommonMark would have resolved into `value`.
      nodes.push({ type: "text", value: decodeString(slice) });
    }
  };

  for (const match of matches) {
    const [matched, inlineBody, displayBody] = match;
    pushText(raw.slice(cursor, match.index));
    nodes.push(
      inlineMathNode(inlineBody ?? displayBody, displayBody !== undefined),
    );
    cursor = match.index + matched.length;
  }

  pushText(raw.slice(cursor));

  return nodes;
};

/**
 * Whether an `inlineMath` node is really a pair of currency amounts.
 *
 * `remark-math` accepts any `$…$` pair once single-dollar math is on, so
 * "between $5 and $10" tokenizes the run between the two amounts as a
 * formula. The two rules below come from `markdown-it-texmath`, the
 * long-standing prior art for single-dollar math in a prose renderer: a real
 * formula never has whitespace hugging its delimiters, and a `$` that closes
 * one amount while opening the next is followed by a digit.
 */
const isCurrencyPair = (node: MathNode, source: string): boolean => {
  const end = node.position?.end.offset;

  if (end === undefined) {
    return false;
  }

  return /^\s|\s$/.test(node.value ?? "") || /\d/.test(source.charAt(end));
};

/** What one `inlineMath` or `text` child rewrites to, and whether it changed. */
type ChildRewrite = { nodes: Array<MathNode>; changed: boolean };

const rewriteInlineMathChild = (
  child: MathNode,
  raw: string | undefined,
  source: string,
): ChildRewrite => {
  // `$$…$$` written inline is display math, never a currency pair.
  if (
    raw === undefined ||
    raw.startsWith("$$") ||
    !isCurrencyPair(child, source)
  ) {
    return { nodes: [child], changed: false };
  }

  // Restore from the source rather than re-wrapping `value` in dollars, so
  // the delimiters come back exactly as written — but decode it, since this
  // is now prose: math content is raw, and a `&amp;` or `\&` inside it has to
  // resolve the way the rest of the paragraph's text does.
  return { nodes: [{ type: "text", value: decodeString(raw) }], changed: true };
};

const rewriteTextChild = (
  child: MathNode,
  raw: string | undefined,
): ChildRewrite => {
  const expanded = raw === undefined ? undefined : expandLatexDelimiters(raw);
  return expanded
    ? { nodes: expanded, changed: true }
    : { nodes: [child], changed: false };
};

const rewriteMathNodes = (node: MathNode, source: string): void => {
  const children = node.children;

  if (!children) {
    return;
  }

  const rewritten: Array<MathNode> = [];
  let changed = false;

  for (const child of children) {
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    const raw =
      start === undefined || end === undefined
        ? undefined
        : source.slice(start, end);

    if (child.type === "inlineMath") {
      const rewrite = rewriteInlineMathChild(child, raw, source);
      rewritten.push(...rewrite.nodes);
      changed ||= rewrite.changed;
      continue;
    }

    if (child.type === "text") {
      const rewrite = rewriteTextChild(child, raw);
      rewritten.push(...rewrite.nodes);
      changed ||= rewrite.changed;
      continue;
    }

    rewriteMathNodes(child, source);
    rewritten.push(child);
  }

  if (!changed) {
    return;
  }

  const only = rewritten.length === 1 ? rewritten[0] : undefined;

  // A paragraph holding nothing but `\[…\]` is display math, and display mode
  // survives sanitize only as a `pre > code` structure — so become that node
  // instead of keeping an inline formula wrapped in a `<p>`.
  if (node.type === "paragraph" && only?.wasDisplayDelimited && only.value) {
    Object.assign(node, displayMathNode(only.value));
    return;
  }

  node.children = rewritten;
};

function hasStringValue(file: { value: unknown }): file is { value: string } {
  return typeof file.value === "string";
}

const remarkRewriteMath = () => (tree: MathNode, file: { value: unknown }) => {
  if (hasStringValue(file)) {
    rewriteMathNodes(tree, file.value);
  }
};

// A preset, so remark-math's parser extensions and this repair pass travel
// together as the one `Pluggable` the math slot accepts.
const math = {
  ...mathPlugin,
  remarkPlugin: {
    plugins: [mathPlugin.remarkPlugin, remarkRewriteMath],
  },
};

const mermaidSecureKeys: NonNullable<MermaidConfig["secure"]> = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
  "htmlLabels",
  "dompurifyConfig",
];

const mermaidSecurityConfig = {
  htmlLabels: false,
  secure: mermaidSecureKeys,
  dompurifyConfig: {
    FORBID_TAGS: ["img", "image"],
  },
} satisfies MermaidConfig;

const streamdownMermaid = createMermaidPlugin({
  config: mermaidSecurityConfig,
});

const mermaidImageAttribute = /\bimg\s*:/i;
const mermaidImageSource = /<\s*(?:img|image)\b|!\[[^\]]*\]\s*\(/i;

type QuoteScanState = {
  quote: '"' | "'" | "`" | undefined;
  escaped: boolean;
};

// One character's worth of quoted-run tracking, factored out so the caller's
// loop nesting stays shallow. Mirrors the original inline branching exactly.
function advanceQuotedCharacter(
  character: string,
  state: QuoteScanState,
): QuoteScanState {
  if (state.escaped) {
    return { ...state, escaped: false };
  }
  if (character === "\\") {
    return { ...state, escaped: true };
  }
  if (character === state.quote) {
    return { ...state, quote: undefined };
  }
  return state;
}

const hasMermaidImageAttribute = (source: string) => {
  let blockStart = source.indexOf("@{");

  while (blockStart !== -1) {
    let blockEnd = blockStart + 2;
    let quote: '"' | "'" | "`" | undefined;
    let escaped = false;
    let unquotedAttributes = "";

    for (; blockEnd < source.length; blockEnd += 1) {
      const character = source[blockEnd];

      if (quote) {
        unquotedAttributes += " ";
        ({ quote, escaped } = advanceQuotedCharacter(character, {
          quote,
          escaped,
        }));
        continue;
      }

      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        unquotedAttributes += " ";
      } else if (character === "}") {
        break;
      } else {
        unquotedAttributes += character;
      }
    }

    if (mermaidImageAttribute.test(unquotedAttributes)) {
      return true;
    }

    blockStart = source.indexOf("@{", blockEnd + 1);
  }

  return false;
};

export const assertSafeMermaidSource = (source: string) => {
  const sourceWithoutComments = source.replaceAll(/^\s*%%(?!\{).*$/gm, "");
  if (
    hasMermaidImageAttribute(sourceWithoutComments) ||
    mermaidImageSource.test(sourceWithoutComments)
  ) {
    throw new Error("Mermaid image nodes are not supported");
  }
};

const mermaid = {
  ...streamdownMermaid,
  getMermaid: (...args: Parameters<typeof streamdownMermaid.getMermaid>) => {
    const instance = streamdownMermaid.getMermaid(...args);

    return {
      ...instance,
      render: (id: string, source: string) => {
        assertSafeMermaidSource(source);
        return instance.render(id, source);
      },
    };
  },
};

export const streamdownPlugins: PluginConfig = {
  // Streamdown and @streamdown/code resolve different Shiki minor versions.
  // Their runtime plugin contract matches; only the language-name union
  // differs. SAFETY: `code` implements CodeHighlighterPlugin's actual runtime
  // shape, so this cast only bridges that nominal, version-local type gap.
  code: code as NonNullable<PluginConfig["code"]>,
  math,
  mermaid,
};
