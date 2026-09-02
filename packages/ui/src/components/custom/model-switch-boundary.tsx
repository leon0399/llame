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

type TruncatedModelIds = { from: boolean; to: boolean };

/**
 * Tracks whether the from/to model id spans are visually truncated (scroll
 * width exceeding client width), re-measuring on resize so the tooltip only
 * carries the untruncated ids when that's actually useful.
 */
function useTruncatedModelIds(fromModelId: string, toModelId: string) {
  const fromModelRef = React.useRef<HTMLSpanElement>(null);
  const toModelRef = React.useRef<HTMLSpanElement>(null);
  const [truncatedModelIds, setTruncatedModelIds] =
    React.useState<TruncatedModelIds>({
      from: false,
      to: false,
    });

  React.useLayoutEffect(() => {
    const measure = () => {
      setTruncatedModelIds({
        from:
          fromModelRef.current !== null &&
          fromModelRef.current.scrollWidth > fromModelRef.current.clientWidth,
        to:
          toModelRef.current !== null &&
          toModelRef.current.scrollWidth > toModelRef.current.clientWidth,
      });
    };

    measure();
    // Checked via `in` rather than `typeof ResizeObserver` so this stays a
    // property lookup, not a narrowing typeof on an unparsed value.
    const observer =
      "ResizeObserver" in globalThis ? new ResizeObserver(measure) : null;
    if (fromModelRef.current) observer?.observe(fromModelRef.current);
    if (toModelRef.current) observer?.observe(toModelRef.current);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [fromModelId, toModelId]);

  return {
    fromModelRef,
    toModelRef,
    truncatedModelIds,
    hasTruncatedModelId: truncatedModelIds.from || truncatedModelIds.to,
  };
}

type ModelSwitchTriggerProps = {
  fromModelId: string;
  toModelId: string;
  fromModelRef: React.RefObject<HTMLSpanElement | null>;
  toModelRef: React.RefObject<HTMLSpanElement | null>;
  open: boolean;
  onToggle: () => void;
  accessibleLabel: string;
};

/** One truncatable model id span, measured via `labelRef` for the tooltip. */
function ModelIdLabel({
  modelId,
  labelRef,
}: {
  modelId: string;
  labelRef: React.RefObject<HTMLSpanElement | null>;
}) {
  return (
    <span
      ref={labelRef}
      className="min-w-0 truncate font-mono text-xs sm:max-w-48"
    >
      {modelId}
    </span>
  );
}

/**
 * The Marker's tooltip trigger: a button summarizing the model change, whose
 * click also drives the sibling Collapsible open (see the boundary's own
 * comment on why Base UI can't make one element both triggers at once).
 */
function ModelSwitchTrigger({
  fromModelId,
  toModelId,
  fromModelRef,
  toModelRef,
  open,
  onToggle,
  accessibleLabel,
}: ModelSwitchTriggerProps) {
  return (
    <TooltipTrigger
      render={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={accessibleLabel}
          aria-expanded={open}
          onClick={onToggle}
          className="h-auto max-w-full min-w-0 py-1.5"
        />
      }
    >
      <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
      <span className="shrink-0 font-medium text-foreground">
        Model changed
      </span>
      <ModelIdLabel modelId={fromModelId} labelRef={fromModelRef} />
      <ArrowRightIcon data-icon="inline" aria-hidden="true" />
      <ModelIdLabel modelId={toModelId} labelRef={toModelRef} />
      {open ? (
        <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
      ) : (
        <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
      )}
    </TooltipTrigger>
  );
}

type TruncatedModelIdsTooltipContentProps = {
  fromModelId: string;
  toModelId: string;
  truncatedModelIds: TruncatedModelIds;
};

/** Reveals whichever model id(s) the trigger truncated, in full. */
function TruncatedModelIdsTooltipContent({
  fromModelId,
  toModelId,
  truncatedModelIds,
}: TruncatedModelIdsTooltipContentProps) {
  return (
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
  );
}

/** The collapsible's expanded detail: what changed, and a link to inspect it. */
function EffectiveContextCard({
  onInspectContext,
}: {
  onInspectContext: () => void;
}) {
  return (
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
  );
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
  const { fromModelRef, toModelRef, truncatedModelIds, hasTruncatedModelId } =
    useTruncatedModelIds(fromModelId, toModelId);
  const accessibleLabel = `Model changed from ${fromModelId} to ${toModelId}`;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full">
      <Marker variant="separator">
        <MarkerContent className="min-w-0 max-w-full">
          <TooltipProvider>
            {/* Uncontrolled: opens on hover, content-gated below so it shows only when it adds value. */}
            <Tooltip>
              <ModelSwitchTrigger
                fromModelId={fromModelId}
                toModelId={toModelId}
                fromModelRef={fromModelRef}
                toModelRef={toModelRef}
                open={open}
                onToggle={() => setOpen((prev) => !prev)}
                accessibleLabel={accessibleLabel}
              />
              {hasTruncatedModelId && (
                <TruncatedModelIdsTooltipContent
                  fromModelId={fromModelId}
                  toModelId={toModelId}
                  truncatedModelIds={truncatedModelIds}
                />
              )}
            </Tooltip>
          </TooltipProvider>
        </MarkerContent>
      </Marker>
      <EffectiveContextCard onInspectContext={onInspectContext} />
    </Collapsible>
  );
}
