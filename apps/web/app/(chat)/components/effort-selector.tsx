"use client";

import * as React from "react";

import { Button } from "@workspace/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";

import { useChatContext } from "@/contexts/chat-context";
import { useModelsQuery } from "@/lib/services/models/queries";
import type { EffortLevelResponse } from "@/lib/api/generated/models";
import { ComposerTooltip } from "./composer-tooltip";

// The slider (Base UI's) loads when the popover first opens, keeping it out of
// every composer page's first-load bundle.
const EffortSelectorSlider = React.lazy(() =>
  import("./effort-selector-slider").then((module) => ({
    default: module.EffortSelectorSlider,
  })),
);

type EffortSelection = {
  levels: Array<EffortLevelResponse>;
  activeIndex: number;
  activeDisplay: string;
  activeHasLabel: boolean;
  setSelectedEffort: (effort: string | undefined) => void;
};

/**
 * The active effort selection, reconciled against the current model's
 * vocabulary — null when the model declares none (renders nothing, per
 * `EffortSelector`'s own doc). Split out so that component composes only
 * markup, not this derivation.
 */
function useActiveEffortSelection(): EffortSelection | null {
  const { selectedModel, selectedEffort, setSelectedEffort } = useChatContext();
  const { data } = useModelsQuery();

  // Falls back to the catalog default, exactly as ModelSelector does for its
  // own label. Without it this component is invisible until ModelSelector's
  // seeding effect commits — a dependency on another component's side effect
  // rather than on the data, which made it render nothing at all whenever it
  // was mounted alone.
  const reasoning = React.useMemo(() => {
    const modelId = selectedModel ?? data?.defaultModelId;
    return data?.models.find((model) => model.id === modelId)?.reasoning;
  }, [data, selectedModel]);
  const levels = reasoning?.effortLevels;

  // Keep the selection valid for the CURRENT model: vocabularies differ, so a
  // level carried over from the previous model may not exist here. Falls back
  // to this model's own default rather than the nearest position, because
  // position carries no meaning across models.
  React.useEffect(() => {
    // Guard matches the render guard below EXACTLY. A model whose vocabulary
    // is present but empty renders nothing, so seeding a default here would
    // set — and send — a level the user can neither see nor change.
    if (!reasoning || reasoning.effortLevels.length === 0) {
      if (selectedEffort !== undefined) setSelectedEffort(undefined);
      return;
    }
    if (
      selectedEffort === undefined ||
      !reasoning.effortLevels.some((level) => level.value === selectedEffort)
    ) {
      setSelectedEffort(reasoning.defaultEffort);
    }
  }, [reasoning, selectedEffort, setSelectedEffort]);

  if (!reasoning || !levels || levels.length === 0) return null;

  // Render against the model's own default until the effect above commits, so
  // the label never flashes an empty or foreign level for a frame.
  const activeLevel =
    selectedEffort !== undefined &&
    levels.some((level) => level.value === selectedEffort)
      ? selectedEffort
      : reasoning.defaultEffort;
  const activeEntry = levels.find((level) => level.value === activeLevel);
  const activeIndex = Math.max(
    0,
    levels.findIndex((level) => level.value === activeLevel),
  );

  return {
    levels,
    activeIndex,
    activeDisplay: activeEntry?.label ?? activeLevel,
    activeHasLabel: activeEntry?.label !== undefined,
    setSelectedEffort,
  };
}

// Muted so the model name beside it stays the primary label; back to
// foreground on the hover and open fills, where muted ink falls below the
// 4.5:1 contrast floor.
const EFFORT_LABEL_CLASS =
  "font-normal text-muted-foreground group-hover/button:text-foreground group-aria-expanded/button:text-foreground";

function EffortSelectorTrigger({
  open,
  activeDisplay,
  activeHasLabel,
  className,
}: {
  open: boolean;
  activeDisplay: string;
  activeHasLabel: boolean;
  className?: string;
}) {
  return (
    <ComposerTooltip
      label="Reasoning effort"
      render={
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              // `xs` (h-6, text-xs), like the model trigger it sits beside.
              size="xs"
              aria-label={`Reasoning effort, ${activeDisplay}`}
              aria-expanded={open}
              className={className}
            />
          }
        />
      }
    >
      <span
        className={cn(
          EFFORT_LABEL_CLASS,
          activeHasLabel ? undefined : "font-mono",
        )}
      >
        {activeDisplay}
      </span>
    </ComposerTooltip>
  );
}

/** The scale's two ends. They describe the TRADE-OFF, which is stable across
 *  providers, rather than naming the extreme levels — those are per-model
 *  tokens and would be wrong on the next model. */
function EffortSelectorScaleLabels() {
  return (
    <div className="text-muted-foreground flex items-center justify-between text-xs">
      <span>Faster</span>
      <span>Smarter</span>
    </div>
  );
}

function EffortSelectorPopoverContent({
  levels,
  activeIndex,
  activeDisplay,
  setSelectedEffort,
}: {
  levels: Array<EffortLevelResponse>;
  activeIndex: number;
  activeDisplay: string;
  setSelectedEffort: (effort: string) => void;
}) {
  return (
    // Anchored ABOVE the trigger so the level label stays visible while the
    // thumb moves — the choice is legible mid-drag, not only after closing.
    <PopoverContent
      // Base UI renders the popover with role=dialog, which needs its own
      // accessible name (axe aria-dialog-name) — the trigger's label does
      // not carry over to it.
      aria-label="Reasoning effort"
      side="top"
      align="end"
      // Width only: PopoverContent's own p-2.5 is the padding.
      className="w-64"
    >
      <div className="flex flex-col gap-2">
        <EffortSelectorScaleLabels />

        <React.Suspense fallback={<div className="h-5" />}>
          <EffortSelectorSlider
            levels={levels}
            activeIndex={activeIndex}
            setSelectedEffort={setSelectedEffort}
          />
        </React.Suspense>

        {/* The slider's own value is an INDEX, which is meaningless read
            aloud ("3"). Base UI exposes `getAriaValueText` on Slider.Thumb,
            which our vendored Slider renders internally and does not forward
            — a real API gap. Until it does, announce the level here rather
            than forking the primitive or letting the control be unreadable.
            Visually hidden because the trigger already shows it. */}
        <span aria-live="polite" className="sr-only">
          {activeDisplay}
        </span>
      </div>
    </PopoverContent>
  );
}

/**
 * Per-turn reasoning effort, as a position on one ordered scale.
 *
 * Renders NOTHING when the selected model declares no effort vocabulary —
 * absence of the `reasoning` object is the api's way of saying this model
 * takes no effort, so an empty or disabled control would misstate it.
 *
 * Selection state is always the opaque `value`. Display prefers an
 * operator-authored `label` when present; unlabeled values stay monospace.
 */
export function EffortSelector({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);
  const selection = useActiveEffortSelection();

  if (!selection) return null;
  const {
    levels,
    activeIndex,
    activeDisplay,
    activeHasLabel,
    setSelectedEffort,
  } = selection;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <EffortSelectorTrigger
        open={open}
        activeDisplay={activeDisplay}
        activeHasLabel={activeHasLabel}
        className={className}
      />
      <EffortSelectorPopoverContent
        levels={levels}
        activeIndex={activeIndex}
        activeDisplay={activeDisplay}
        setSelectedEffort={setSelectedEffort}
      />
    </Popover>
  );
}
