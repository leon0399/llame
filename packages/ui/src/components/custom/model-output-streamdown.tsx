"use client";

import { SquareArrowOutUpRightIcon } from "lucide-react";
import { createElement, Fragment, useMemo, useSyncExternalStore } from "react";
import type { PluginConfig, StreamdownProps } from "streamdown";
import {
  defaultRehypePlugins,
  defaultRemarkPlugins,
  Streamdown,
} from "streamdown";

import { streamdownPlugins } from "@workspace/ui/components/ai-elements/streamdown-plugins";
import {
  OUTBOUND_LINK_TAG,
  rehypeOutboundLinks,
} from "@workspace/ui/lib/outbound-link";
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

/**
 * Trailing mark for a link that leaves llame, appended inside Streamdown's
 * link control so the confirmation modal stays that renderer's. The icon is
 * decorative. The accessible-name algorithm joins child text with spaces, so
 * the suffix is its own element and the name reads as "<label> opens in a
 * new tab". `createElement` avoids a whitespace text node that would join as
 * a second space. `ms-0.5` is the gap after the label (the same 0.5 step app
 * chrome uses) and keeps the icon on the last line when the label wraps.
 * Tailwind's preflight sets `svg { display: block }`, so the icon is
 * `inline-block`.
 */
const OutboundLinkAffordance = () =>
  createElement(
    Fragment,
    null,
    createElement(SquareArrowOutUpRightIcon, {
      "aria-hidden": true,
      className: "ms-0.5 inline-block size-3 align-text-bottom",
    }),
    createElement("span", { className: "sr-only" }, "opens in a new tab"),
  );

const modelOutputComponents = {
  [REGEX_TOKEN_TAG]: RegexProseToken,
  [OUTBOUND_LINK_TAG]: OutboundLinkAffordance,
};

/** The page origin cannot change during a session. */
const subscribeToNothing = () => () => {};

const resolveOverlayContainer = (
  anchor: HTMLElement,
): HTMLElement | undefined =>
  anchor.closest<HTMLElement>(
    '[data-streamdown="table-fullscreen"], [aria-modal="true"], dialog',
  ) ?? undefined;

/**
 * Complete, security-hardened renderer for model-authored Markdown. Callers
 * receive presentation/render-state props only; regex adapters, sanitization,
 * link safety, outbound-link marking, plugin identities, and component
 * mappings are atomic here.
 */
export const ModelOutputStreamdown = ({
  children,
  ...props
}: ModelOutputStreamdownProps) => {
  // SSR and hydration share `""`, so the first HTML matches. Streamdown
  // memoizes itself without comparing `rehypePlugins`, and its link renderer
  // ignores children, so a later parse cannot take an icon back. Remounting
  // when the origin arrives re-parses from scratch.
  const ownOrigin = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => "",
  );

  const rehypePlugins = useMemo(
    () => [
      ...modelOutputRehypePlugins,
      [rehypeOutboundLinks, { ownOrigin }] satisfies [
        typeof rehypeOutboundLinks,
        { ownOrigin: string },
      ],
    ],
    [ownOrigin],
  );

  return (
    <RegexTesterProvider resolveOverlayContainer={resolveOverlayContainer}>
      <Streamdown
        {...props}
        key={ownOrigin === "" ? "origin-pending" : ownOrigin}
        plugins={modelOutputPlugins}
        remarkPlugins={modelOutputRemarkPlugins}
        rehypePlugins={rehypePlugins}
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
