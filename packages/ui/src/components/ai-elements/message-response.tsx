"use client";

import type { ComponentProps } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

import { streamdownPlugins } from "@workspace/ui/components/ai-elements/streamdown-plugins";
import { RegexTesterStreamdown } from "@workspace/ui/components/custom/regex-tester";
import { cn } from "@workspace/ui/lib/utils";

export type MessageResponseProps = Omit<
  ComponentProps<typeof Streamdown>,
  "plugins"
>;

/**
 * Renders a message's markdown `children` (headings, lists, code, links,
 * tables, math, Mermaid, …) via [Streamdown](https://github.com/vercel/streamdown),
 * memoized on `children` so re-parsing is skipped when only sibling props
 * change during streaming.
 *
 * Kept separate from the lightweight message primitives so chat routes can
 * defer the code/math/Mermaid dependency graph until transcript content is
 * actually rendered.
 *
 * This component carries a deliberate security fork over upstream AI
 * Elements — see the `linkSafety`/`disallowedElements` comment below — which
 * must be preserved across updates.
 *
 * Vendored from [AI Elements' Message](https://elements.ai-sdk.dev/components/message).
 */
export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    // RegexTesterStreamdown = Streamdown + the regex-tester wiring (remark
    // pass, token component, sanitize whitelist, click-delegating popover
    // host); code-block literals arrive via the Shiki wrapper in `plugins`.
    <RegexTesterStreamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      {...props}
      plugins={streamdownPlugins}
      // fork: MessageResponse renders model output in a multi-tenant app, so
      // harden Streamdown — external links go through its confirmation modal,
      // and images are dropped entirely (auto-loaded remote images are a
      // tracking/SSRF surface; image support is out of scope). Set after
      // {...props} so a call site can't accidentally re-open them.
      linkSafety={{ enabled: true }}
      disallowedElements={["img"]}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

MessageResponse.displayName = "MessageResponse";
