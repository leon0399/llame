import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { createMermaidPlugin, type MermaidConfig } from "@streamdown/mermaid";
import type { PluginConfig } from "streamdown";

// `@streamdown/math`'s packaged `math` export hardcodes
// `singleDollarTextMath: false`, so `$x$` stays literal text and only `$$x$$`
// renders. Models (and people) overwhelmingly write inline math with single
// dollars, so enable it. The known cost: two currency amounts in one paragraph
// collide — "between $5 and $10" parses "5 and " as math. Writing `\$` opts
// out, and code spans are never touched.
const math = createMathPlugin({ singleDollarTextMath: true });

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
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === quote) {
          quote = undefined;
        }
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
  const sourceWithoutComments = source.replace(/^\s*%%(?!\{).*$/gm, "");
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

// A fenced block (closed, or still open mid-stream) or an inline code span.
// Capturing so `String.prototype.split` keeps these regions as odd-indexed
// segments that normalization skips.
const codeRegions = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g;
const parenMath = /\\\(([\s\S]+?)\\\)/g;
const bracketMath = /\\\[([\s\S]+?)\\\]/g;

/**
 * Rewrites LaTeX `\(…\)` / `\[…\]` delimiters to the `$…$` / `$$…$$` form
 * `remark-math` understands, leaving fenced blocks and inline code alone.
 *
 * Several providers emit the escaped-paren form by default, and it cannot be
 * handled downstream: CommonMark treats `\(` as an escaped literal paren and
 * drops the backslash during parsing, so by the time any remark/rehype plugin
 * runs the delimiter is already gone. The rewrite therefore has to happen on
 * the source string, before Streamdown parses it.
 *
 * Streaming-safe: an unterminated delimiter is left untouched until its
 * closing half arrives.
 */
export const normalizeMathDelimiters = (markdown: string): string => {
  if (!markdown.includes("\\(") && !markdown.includes("\\[")) {
    return markdown;
  }

  return markdown
    .split(codeRegions)
    .map((segment, index) =>
      index % 2 === 1
        ? segment
        : segment
            .replace(bracketMath, (_match, body: string) => `$$${body}$$`)
            .replace(parenMath, (_match, body: string) => `$${body}$`),
    )
    .join("");
};

export const streamdownPlugins: PluginConfig = {
  // Streamdown and @streamdown/code resolve different Shiki minor versions.
  // Their runtime plugin contract matches; only the language-name union differs.
  code: code as NonNullable<PluginConfig["code"]>,
  math,
  mermaid,
};
