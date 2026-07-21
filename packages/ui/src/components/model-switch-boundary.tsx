"use client";

import * as React from "react";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileSearchIcon,
  RefreshCwIcon,
} from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
} from "@workspace/ui/components/collapsible";
import { Marker, MarkerContent } from "@workspace/ui/components/marker";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

export interface ModelSwitchBoundaryProps {
  /** Public model id used by the preceding run. */
  fromModelId: string;
  /** Public model id selected for the user turn immediately after the boundary. */
  toModelId: string;
  /** Opens the owner-only receipt for the target run's effective prompt and tools. */
  onInspectContext: () => void;
}

/**
 * Marks the exact transcript boundary where a user turn switched models and
 * provides progressive disclosure for the target run's effective context.
 *
 * @summary for transparently marking a model change in chat history
 */
export function ModelSwitchBoundary({
  fromModelId,
  toModelId,
  onInspectContext,
}: ModelSwitchBoundaryProps) {
  const [open, setOpen] = React.useState(false);
  const fromModelRef = React.useRef<HTMLSpanElement>(null);
  const toModelRef = React.useRef<HTMLSpanElement>(null);
  const [truncatedModelIds, setTruncatedModelIds] = React.useState({
    from: false,
    to: false,
  });
  const hasTruncatedModelId = truncatedModelIds.from || truncatedModelIds.to;
  const accessibleLabel = `Model changed from ${fromModelId} to ${toModelId}`;

  React.useLayoutEffect(() => {
    const measure = () => {
      const nextTruncatedModelIds = {
        from:
          fromModelRef.current !== null &&
          fromModelRef.current.scrollWidth > fromModelRef.current.clientWidth,
        to:
          toModelRef.current !== null &&
          toModelRef.current.scrollWidth > toModelRef.current.clientWidth,
      };
      setTruncatedModelIds(nextTruncatedModelIds);
    };

    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    if (fromModelRef.current) observer?.observe(fromModelRef.current);
    if (toModelRef.current) observer?.observe(toModelRef.current);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [fromModelId, toModelId]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full">
      <Marker variant="separator">
        <MarkerContent className="min-w-0 max-w-full">
          <TooltipProvider>
            {/* Uncontrolled: the tooltip opens on hover, but only has content
                when a model id is actually truncated (see the conditional
                TooltipContent below), so it shows only when it adds value. */}
            <Tooltip>
              {/* The button is the tooltip trigger (single `asChild`, which
                  Base UI supports) and toggles the collapsible itself via
                  onClick — Base UI can't make one element both a Tooltip and a
                  Collapsible trigger, so `CollapsibleTrigger` is skipped and the
                  Collapsible is driven by the `open` state. */}
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={accessibleLabel}
                  aria-expanded={open}
                  onClick={() => setOpen((prev) => !prev)}
                  className="h-auto max-w-full min-w-0 py-1.5"
                >
                  <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
                  <span className="shrink-0 font-medium text-foreground">
                    Model changed
                  </span>
                  <span
                    ref={fromModelRef}
                    className="min-w-0 truncate font-mono text-xs sm:max-w-48"
                  >
                    {fromModelId}
                  </span>
                  <ArrowRightIcon data-icon="inline" aria-hidden="true" />
                  <span
                    ref={toModelRef}
                    className="min-w-0 truncate font-mono text-xs sm:max-w-48"
                  >
                    {toModelId}
                  </span>
                  {open ? (
                    <ChevronDownIcon
                      data-icon="inline-end"
                      aria-hidden="true"
                    />
                  ) : (
                    <ChevronRightIcon
                      data-icon="inline-end"
                      aria-hidden="true"
                    />
                  )}
                </Button>
              </TooltipTrigger>
              {hasTruncatedModelId && (
                <TooltipContent className="max-w-sm">
                  <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-1 text-left">
                    {truncatedModelIds.from && (
                      <>
                        <dt className="opacity-70">Previous</dt>
                        <dd className="break-all font-mono">{fromModelId}</dd>
                      </>
                    )}
                    {truncatedModelIds.to && (
                      <>
                        <dt className="opacity-70">Current</dt>
                        <dd className="break-all font-mono">{toModelId}</dd>
                      </>
                    )}
                  </dl>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </MarkerContent>
      </Marker>
      <CollapsibleContent className="pt-2">
        <Card className="gap-3 py-4 shadow-xs">
          <CardHeader className="gap-1 px-4">
            <CardTitle className="text-sm">Effective context changed</CardTitle>
            <CardDescription>
              This turn used the target model&apos;s effective system prompt and
              advertised tool contract. Earlier conversation text remained in
              context where it fit.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={onInspectContext}
            >
              <FileSearchIcon data-icon="inline-start" aria-hidden="true" />
              View effective context
            </Button>
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}
