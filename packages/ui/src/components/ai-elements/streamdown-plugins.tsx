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
  // Streamdown 2.5's CodeHighlighterPlugin still names Shiki 3.7's narrower
  // language union; every published @streamdown/code release requires 3.19+.
  // The runtime plugin contract is otherwise identical.
  // @ts-expect-error -- upstream Streamdown/@streamdown-code Shiki type skew
  code,
  math,
  mermaid,
};
