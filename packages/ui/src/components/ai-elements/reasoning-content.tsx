"use client";

import { CollapsibleContent } from "@workspace/ui/components/collapsible";
import type { ComponentProps } from "react";
import { memo } from "react";

import { ModelOutputStreamdown } from "@workspace/ui/components/custom/model-output-streamdown";
import { separateGluedReasoningBlocks } from "@workspace/ui/lib/reasoning-blocks";
import { cn } from "@workspace/ui/lib/utils";

export type ReasoningContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  /** The reasoning text, rendered as markdown via Streamdown. */
  children: string;
};

/**
 * The markdown-rendered panel body toggled by `ReasoningTrigger`.
 *
 * Kept separate from the lightweight reasoning controls so chat routes can
 * defer the code/math/Mermaid dependency graph until reasoning is rendered.
 *
 * @summary for the markdown-rendered body of a Reasoning panel
 */
export const ReasoningContent = memo(
  ({ className, children, ...props }: ReasoningContentProps) => (
    <CollapsibleContent
      className={cn(
        "mt-4 text-sm",
        "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
        // Summary parts open with a bold heading; lift those isolated titles
        // out of the muted body so they read as section headings.
        "[&_p:has(>strong:only-child)]:text-foreground",
        className,
      )}
      {...props}
    >
      <ModelOutputStreamdown>
        {separateGluedReasoningBlocks(children)}
      </ModelOutputStreamdown>
    </CollapsibleContent>
  ),
);

ReasoningContent.displayName = "ReasoningContent";
