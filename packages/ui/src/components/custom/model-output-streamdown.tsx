"use client";

import type { PluginConfig, StreamdownProps } from "streamdown";
import {
  defaultRehypePlugins,
  defaultRemarkPlugins,
  Streamdown,
} from "streamdown";

import { streamdownPlugins } from "@workspace/ui/components/ai-elements/streamdown-plugins";
import { RegexProseToken, RegexTesterProvider } from "#regex-tester/provider";
import { withRegexTokens } from "#regex-tester/code-highlighter";
import {
  rehypeRegexTokens,
  remarkRegexTokens,
  regexTokenAllowedTags,
} from "#regex-tester/markdown";
import { REGEX_TOKEN_TAG } from "#regex-tester/token";

/**
 * The intentionally narrow presentation surface for model-authored output.
 * Parser, sanitizer, URL, element-filter, component, plugin, Mermaid, and
 * raw-HTML controls stay owned by this composition root.
 */
export type ModelOutputStreamdownProps = Pick<
  StreamdownProps,
  | "animated"
  | "caret"
  | "children"
  | "className"
  | "controls"
  | "dir"
  | "icons"
  | "isAnimating"
  | "lineNumbers"
  | "mode"
  | "onAnimationEnd"
  | "onAnimationStart"
  | "prefix"
  | "shikiTheme"
  | "translations"
>;

const modelOutputPlugins: PluginConfig = {
  ...streamdownPlugins,
  // SAFETY: streamdown-plugins.tsx always assigns `code` in
  // `streamdownPlugins`, so it's never undefined here despite
  // PluginConfig's optional field type.
  code: withRegexTokens(
    streamdownPlugins.code as NonNullable<PluginConfig["code"]>,
  ),
};

const modelOutputRemarkPlugins = [
  ...Object.values(defaultRemarkPlugins),
  remarkRegexTokens,
];

const modelOutputRehypePlugins = [
  ...Object.values(defaultRehypePlugins),
  rehypeRegexTokens,
];

const modelOutputComponents = {
  [REGEX_TOKEN_TAG]: RegexProseToken,
};

const resolveOverlayContainer = (
  anchor: HTMLElement,
): HTMLElement | undefined =>
  anchor.closest<HTMLElement>(
    '[data-streamdown="table-fullscreen"], [aria-modal="true"], dialog',
  ) ?? undefined;

/**
 * Complete, security-hardened renderer for model-authored Markdown. Callers
 * receive presentation/render-state props only; regex adapters, sanitization,
 * link safety, plugin identities, and component mappings are atomic here.
 */
export const ModelOutputStreamdown = ({
  children,
  ...props
}: ModelOutputStreamdownProps) => (
  <RegexTesterProvider resolveOverlayContainer={resolveOverlayContainer}>
    <Streamdown
      {...props}
      plugins={modelOutputPlugins}
      remarkPlugins={modelOutputRemarkPlugins}
      rehypePlugins={modelOutputRehypePlugins}
      components={modelOutputComponents}
      allowedTags={regexTokenAllowedTags}
      linkSafety={{ enabled: true }}
      disallowedElements={["img"]}
    >
      {children}
    </Streamdown>
  </RegexTesterProvider>
);

ModelOutputStreamdown.displayName = "ModelOutputStreamdown";
