import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid as streamdownMermaid } from "@streamdown/mermaid";
import type { PluginConfig } from "streamdown";

const mermaidImageShape = /\bimg\s*:/i;

export const assertSafeMermaidSource = (source: string) => {
  if (mermaidImageShape.test(source)) {
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
