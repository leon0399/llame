import type mermaidApi from "mermaid";
import type { MermaidConfig } from "mermaid";
import { bundledLanguages, bundledLanguagesInfo } from "shiki/langs";
import type { PluginConfig } from "streamdown";

type CodeHighlighterPlugin = NonNullable<PluginConfig["code"]>;

// `@streamdown/code`'s alias resolution, from Shiki's language table alone.
const codeLanguageAliases: Record<string, string> = Object.fromEntries(
  bundledLanguagesInfo.flatMap((info) =>
    (info.aliases ?? []).map((alias) => [alias, info.id]),
  ),
);
const codeLanguages = new Set(Object.keys(bundledLanguages));
// `@streamdown/code`'s default themes; Streamdown passes its own per call.
const codeThemes: ReturnType<CodeHighlighterPlugin["getThemes"]> = [
  "github-light",
  "github-dark",
];

let codePlugin: CodeHighlighterPlugin | undefined;
let codePluginLoad: Promise<CodeHighlighterPlugin> | undefined;

/**
 * `@streamdown/code` behind its own contract, code-split on purpose: it pulls
 * in Shiki's highlighter core (~50 KB gzipped), which loads on the first code
 * block instead of with every transcript. `highlight` already answers through
 * its callback while a grammar loads, so a block renders as plain text until
 * then, as it did before.
 */
const code: CodeHighlighterPlugin = {
  name: "shiki",
  type: "code-highlighter",
  supportsLanguage: (language) => {
    const normalized = language.trim().toLowerCase();
    return codeLanguages.has(codeLanguageAliases[normalized] ?? normalized);
  },
  getSupportedLanguages: () =>
    // SAFETY: the keys of Shiki's language table are exactly its language
    // ids; only the version-local union type is lost through `Object.keys`.
    [...codeLanguages] as ReturnType<
      CodeHighlighterPlugin["getSupportedLanguages"]
    >,
  getThemes: () => codeThemes,
  highlight: (options, callback) => {
    if (codePlugin) return codePlugin.highlight(options, callback);
    codePluginLoad ??= import("@streamdown/code").then((module) => {
      // SAFETY: Streamdown and @streamdown/code resolve different Shiki
      // minor versions. Their runtime plugin contract matches; only the
      // language-name union differs, so this bridges that nominal gap.
      codePlugin = module.code as CodeHighlighterPlugin;
      return codePlugin;
    });
    void codePluginLoad.then(
      (plugin) => {
        // A cached result returns synchronously without the callback.
        const result = plugin.highlight(options, callback);
        if (result) callback?.(result);
      },
      // A failed chunk fetch leaves this block as plain text; the next block
      // retries.
      () => {
        codePluginLoad = undefined;
      },
    );
    return null;
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

// The defaults `@streamdown/mermaid` applied, plus the security config above.
const mermaidConfig: MermaidConfig = {
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict",
  fontFamily: "monospace",
  suppressErrorRendering: true,
  ...mermaidSecurityConfig,
};

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

let mermaidLoad: Promise<typeof mermaidApi> | undefined;
let mermaidInitConfig = mermaidConfig;
let mermaidInitialized = false;

/**
 * Streamdown's diagram plugin contract, with Mermaid (~150 KB gzipped with
 * its d3 and DOMPurify dependencies) code-split on purpose: it loads on the
 * first diagram render, so transcripts without diagrams never fetch it.
 * `render` is async in the contract, which is what makes this possible.
 */
const mermaidInstance = {
  initialize: (config: MermaidConfig) => {
    mermaidInitConfig = { ...mermaidConfig, ...config };
    mermaidInitialized = false;
  },
  render: async (id: string, source: string) => {
    assertSafeMermaidSource(source);
    mermaidLoad ??= import("mermaid").then((module) => module.default);
    const mermaid = await mermaidLoad;
    if (!mermaidInitialized) {
      mermaid.initialize(mermaidInitConfig);
      mermaidInitialized = true;
    }
    return await mermaid.render(id, source);
  },
};

const mermaid: NonNullable<PluginConfig["mermaid"]> = {
  name: "mermaid",
  type: "diagram",
  language: "mermaid",
  getMermaid: (config) => {
    if (config) mermaidInstance.initialize(config);
    return mermaidInstance;
  },
};

export const streamdownPlugins: PluginConfig = {
  code,
  mermaid,
};
