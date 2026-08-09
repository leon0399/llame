import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { createMermaidPlugin, type MermaidConfig } from "@streamdown/mermaid";
import type { PluginConfig } from "streamdown";

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

const mermaidImageSource =
  /@\{[^}]*\bimg\s*:|<\s*(?:img|image)\b|!\[[^\]]*\]\s*\(/i;

export const assertSafeMermaidSource = (source: string) => {
  const sourceWithoutComments = source.replace(/^\s*%%(?!\{).*$/gm, "");
  if (mermaidImageSource.test(sourceWithoutComments)) {
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
  // Their runtime plugin contract matches; only the language-name union differs.
  code: code as NonNullable<PluginConfig["code"]>,
  math,
  mermaid,
};
