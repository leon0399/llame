"use client";

import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Slider } from "@workspace/ui/components/slider";
import { cn } from "@workspace/ui/lib/utils";

import { useChatContext } from "@/contexts/chat-context";
import { useModelsQuery } from "@/lib/services/models/queries";
import type { EffortLevelResponse } from "@/lib/api/generated/models";

/**
 * Bold treatment of the shared Slider, composed rather than forked.
 *
 * The vendored primitive is deliberately understated (a 1px rail, a small
 * thumb) because most sliders should be. This one is a primary composer
 * control sitting beside the send button, so it earns a thicker rail and a
 * larger handle — expressed here, through the primitive's `data-slot` hooks,
 * so no other Slider in the app inherits the emphasis.
 *
 * Achromatic on purpose: `bg-primary` is Ink in light mode and near-white in
 * dark. DESIGN.md §12.1 records "no brand hue" as an INTENTIONALLY UNDECIDED
 * question, so painting this control blue would resolve a documented open
 * decision by drift. Boldness here comes from weight and contrast instead.
 */
const BOLD_SLIDER_CLASS = cn(
  "[&_[data-slot=slider-track]]:h-2.5!",
  "[&_[data-slot=slider-track]]:bg-muted",
  "[&_[data-slot=slider-thumb]]:size-5!",
  "[&_[data-slot=slider-thumb]]:border-2",
  "[&_[data-slot=slider-thumb]]:border-primary",
  "[&_[data-slot=slider-thumb]]:shadow-sm",
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
    <PopoverTrigger
      render={
        <Button
          type="button"
          variant="outline"
          // Same box as the other two cells: "default" is h-8, matching the
          // send cell's size="icon" (size-8).
          size="default"
          aria-label={`Reasoning effort, ${activeDisplay}`}
          aria-expanded={open}
          // No corner, border, or focus-lift classes: ButtonGroup owns all
          // three for every cell, so restating them here is how cells drift.
          className={cn("gap-1 font-normal", className)}
        >
          <span
            className={cn("text-xs", activeHasLabel ? undefined : "font-mono")}
          >
            {activeDisplay}
          </span>
          <ChevronDownIcon size={14} aria-hidden className="opacity-60" />
        </Button>
      }
    />
  );
}

/** Stop markers. Decorative — the slider itself is the control, and these
 *  only make the discrete positions legible. `justify-between` lines them up
 *  with the thumb's travel because the primitive is rendered with
 *  `thumbAlignment="edge"`. */
function EffortSelectorStops({
  levels,
  activeIndex,
}: {
  levels: Array<EffortLevelResponse>;
  activeIndex: number;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-between px-[0.4rem]"
    >
      {levels.map((level, index) => (
        <span
          key={level.value}
          className={cn(
            "size-1 rounded-full",
            index <= activeIndex
              ? "bg-primary-foreground/70"
              : "bg-muted-foreground/40",
          )}
        />
      ))}
    </div>
  );
}

type EffortSelectorSliderProps = {
  levels: Array<EffortLevelResponse>;
  activeIndex: number;
  setSelectedEffort: (effort: string) => void;
};

/** The slider plus its decorative stop markers — split out from the popover
 *  content around it since it owns its own value-change wiring. */
function EffortSelectorSlider({
  levels,
  activeIndex,
  setSelectedEffort,
}: EffortSelectorSliderProps) {
  return (
    <div className="relative">
      <Slider
        min={0}
        max={levels.length - 1}
        step={1}
        value={[activeIndex]}
        onValueChange={(value) => {
          const next = Array.isArray(value) ? value[0] : value;
          const level = levels[next ?? 0];
          // Live: the trigger label re-renders from context as the thumb
          // moves, so the choice is legible before the popup closes.
          if (level !== undefined) setSelectedEffort(level.value);
        }}
        aria-label="Reasoning effort"
        className={BOLD_SLIDER_CLASS}
      />
      <EffortSelectorStops levels={levels} activeIndex={activeIndex} />
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
      className="w-64 p-3"
    >
      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          {/* The ends describe the TRADE-OFF, which is stable across
              providers, rather than naming the extreme levels — those are
              per-model tokens and would be wrong on the next model. */}
          <span>Faster</span>
          <span>Smarter</span>
        </div>

        <EffortSelectorSlider
          levels={levels}
          activeIndex={activeIndex}
          setSelectedEffort={setSelectedEffort}
        />

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
