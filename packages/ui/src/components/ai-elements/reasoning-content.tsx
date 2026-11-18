"use client";

import { TraceCollapsibleContent } from "@workspace/ui/components/trace";
import type { ComponentProps } from "react";
import { memo } from "react";

import { ModelOutputStreamdown } from "@workspace/ui/components/custom/model-output-streamdown";
import { separateGluedReasoningBlocks } from "@workspace/ui/lib/reasoning-blocks";
import { cn } from "@workspace/ui/lib/utils";

export type ReasoningContentProps = ComponentProps<
  typeof TraceCollapsibleContent
> & {
  /** The reasoning text, rendered as markdown via Streamdown. */
  children: string;
};

/**
 * The markdown-rendered panel body toggled by `ReasoningTrigger`.
 *
 * Glued summary headings are separated here, at the value being displayed:
 * the persisted part keeps the provider's exact text (see
 * `@workspace/ui/lib/reasoning-blocks`).
 *
 * Kept separate from the lightweight reasoning controls so chat routes can
 * defer the code/math/Mermaid dependency graph until reasoning is rendered.
 *
 * @summary for the markdown-rendered body of a Reasoning panel
 */
export const ReasoningContent = memo(
  ({ className, children, ...props }: ReasoningContentProps) => (
    <TraceCollapsibleContent className={cn("text-sm", className)} {...props}>
      <ModelOutputStreamdown>
        {separateGluedReasoningBlocks(children)}
      </ModelOutputStreamdown>
    </TraceCollapsibleContent>
  ),
);

ReasoningContent.displayName = "ReasoningContent";
