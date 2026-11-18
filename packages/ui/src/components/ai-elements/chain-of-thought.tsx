"use client";

import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@workspace/ui/components/trace";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
} from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";
import { useState, type ReactElement, type ReactNode } from "react";

export type ChainOfThoughtProps = {
  /** The summary line: what the steps amount to, e.g. "Worked through 5 steps". */
  title: string;
  /**
   * Whether the steps are still being produced. While `true` the group is
   * open and its title shimmers; once `false` it collapses to its summary,
   * unless the reader opened or closed it themselves.
   */
  running: boolean;
  /** Marks the summary when a step failed, so a collapsed group still says so. */
  failed?: boolean;
  /**
   * Whether the steps fold behind the summary. A run too short to be worth a
   * summary sets this `false`: the steps then show as they are, in the same
   * place in the tree, so a run that grows long enough to fold keeps the state
   * of the steps it already shows.
   */
  folds?: boolean;
  /** The steps: `Tool` and `Reasoning` lines, in order. */
  children: ReactNode;
};

/**
 * ChainOfThought folds the steps an agent took between two pieces of its
 * answer — its thinking and its tool calls — into one summary line that
 * expands into them. A finished group takes one line of the transcript however
 * many steps it holds.
 *
 * Follows the shadcn/ui [Chain of Thought](https://ui.shadcn.com/docs/ai-elements/base/chain-of-thought)
 * pattern, built on Trace.
 *
 * @summary for a run of agent steps collapsed behind one summary line
 */
export function ChainOfThought({
  title,
  running,
  failed = false,
  folds = true,
  children,
}: ChainOfThoughtProps): ReactElement {
  // Undefined until the reader toggles the group; until then it follows
  // `running`, so it opens with the first step and closes with the last.
  const [open, setOpen] = useState<boolean>();
  const status = running ? "running" : failed ? "error" : undefined;

  return (
    // Unfolded, the panel is only a holder: no indent and no rule. Its padding
    // keeps the steps' focus rings inside the panel's clip, and the negative
    // margin puts the steps back in line with the text around them.
    <Trace className={cn("not-prose", !folds && "-m-1 w-auto")}>
      <TraceCollapsible
        open={!folds || (open ?? running)}
        onOpenChange={setOpen}
      >
        {folds ? (
          <TraceCollapsibleTrigger>
            <TraceLine status={status}>
              <TraceIcon>
                {running ? (
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                ) : failed ? (
                  <CircleAlertIcon />
                ) : (
                  <CircleCheckIcon />
                )}
              </TraceIcon>
              <TraceTitle>{title}</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
        ) : null}
        {/* Kept mounted, so steps keep their open state when the summary closes. */}
        <TraceCollapsibleContent
          keepMounted
          className={folds ? undefined : "m-0 border-l-0 p-1"}
        >
          <Trace>{children}</Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
