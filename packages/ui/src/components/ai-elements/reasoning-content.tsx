"use client";

import { CollapsibleContent } from "@workspace/ui/components/collapsible";
import type { ComponentProps } from "react";
import { memo } from "react";

import { streamdownPlugins } from "@workspace/ui/components/ai-elements/streamdown-plugins";
import { RegexTesterStreamdown } from "@workspace/ui/components/custom/regex-tester";
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
        className,
      )}
      {...props}
    >
      {/* fork: reasoning is model output — harden Streamdown (external-link
          confirmation modal; images dropped, out of scope). Do not spread
          Collapsible props onto Streamdown. RegexTesterStreamdown carries the
          regex-tester wiring — the shared `plugins` object already decorates
          code-block literals, so a bare Streamdown here would render them
          underlined but inert. */}
      <RegexTesterStreamdown
        plugins={streamdownPlugins}
        linkSafety={{ enabled: true }}
        disallowedElements={["img"]}
      >
        {children}
      </RegexTesterStreamdown>
    </CollapsibleContent>
  ),
);

ReasoningContent.displayName = "ReasoningContent";
