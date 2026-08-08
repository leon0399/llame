import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { PluginConfig } from "streamdown";

export const streamdownPlugins: PluginConfig = {
  // Streamdown 2.5's CodeHighlighterPlugin still names Shiki 3.7's narrower
  // language union; every published @streamdown/code release requires 3.19+.
  // The runtime plugin contract is otherwise identical.
  // @ts-expect-error -- upstream Streamdown/@streamdown-code Shiki type skew
  code,
  math,
  mermaid,
};
