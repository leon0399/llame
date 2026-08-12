"use client";

import { memo } from "react";

import {
  ModelOutputStreamdown,
  type ModelOutputStreamdownProps,
} from "@workspace/ui/components/custom/model-output-streamdown";
import { cn } from "@workspace/ui/lib/utils";

export type MessageResponseProps = ModelOutputStreamdownProps;

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
 * The model-output composition root owns the deliberate security fork over
 * upstream AI Elements: safe external-link handling and image blocking.
 *
 * Vendored from [AI Elements' Message](https://elements.ai-sdk.dev/components/message).
 */
export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <ModelOutputStreamdown
      {...props}
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

MessageResponse.displayName = "MessageResponse";
