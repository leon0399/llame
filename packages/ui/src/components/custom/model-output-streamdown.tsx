"use client";

import { useEffect, useSyncExternalStore } from "react";
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

let modelOutputMathPlugins: PluginConfig | undefined;
let mathLoad: Promise<void> | undefined;
const mathListeners = new Set<() => void>();

// `$`, `\(`, or `\[`: the delimiters the math plugin parses. A currency
// amount also matches, which only costs the load.
const mathDelimiter = /\$|\\[([]/;

function loadMathPlugins(): void {
  // Code-split on purpose: KaTeX is ~75 KB gzipped and most model output has
  // no math, so it loads the first time some output might contain math.
  mathLoad ??=
    import("@workspace/ui/components/ai-elements/streamdown-math").then(
      ({ math }) => {
        modelOutputMathPlugins = { ...modelOutputPlugins, math };
        for (const listener of mathListeners) listener();
      },
      // A failed chunk fetch leaves math as literal text; the next render that
      // needs it retries.
      () => {
        mathLoad = undefined;
      },
    );
}

function subscribeMath(listener: () => void): () => void {
  mathListeners.add(listener);
  return () => mathListeners.delete(listener);
}

const readMathPlugins = () => modelOutputMathPlugins;

/** The plugin set for `markdown`: math rendering joins once its chunk has
 *  loaded, and the load starts only when `markdown` has a math delimiter. */
function useModelOutputPlugins(markdown: string | undefined): PluginConfig {
  const withMath = useSyncExternalStore(
    subscribeMath,
    readMathPlugins,
    readMathPlugins,
  );
  const needsMath = markdown !== undefined && mathDelimiter.test(markdown);
  useEffect(() => {
    if (needsMath && withMath === undefined) loadMathPlugins();
  }, [needsMath, withMath]);
  return withMath ?? modelOutputPlugins;
}

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
}: ModelOutputStreamdownProps) => {
  const plugins = useModelOutputPlugins(children);
  return (
    <RegexTesterProvider resolveOverlayContainer={resolveOverlayContainer}>
      <Streamdown
        // Streamdown's streaming mode keeps its rendered blocks when only
        // `plugins` changes, so math arriving late remounts it instead.
        key={plugins === modelOutputPlugins ? "plain" : "math"}
        {...props}
        plugins={plugins}
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
};

ModelOutputStreamdown.displayName = "ModelOutputStreamdown";
