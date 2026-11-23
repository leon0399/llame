"use client";

import * as React from "react";

import { Button } from "@workspace/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Slider } from "@workspace/ui/components/slider";
import { cn } from "@workspace/ui/lib/utils";

import { useChatContext } from "@/contexts/chat-context";
import type { EffortLevelResponse } from "@/lib/api/generated/models";
import { useComposerSelection } from "./use-composer-selection";
import { ComposerTooltip } from "./composer-tooltip";

/**
 * Bold treatment of the shared Slider, composed rather than forked.
 *
 * The vendored primitive is deliberately understated (a 1px rail, a small
 * thumb) because most sliders should be. This one is a primary composer
 * control sitting beside the send button, so it earns a thicker rail and a
 * larger handle — expressed here, through the primitive's `data-slot` hooks,
 * so no other Slider in the app inherits the emphasis.
 *
 * The emphasis is carried by SIZE alone — a 10px rail against the primitive's
 * 4px, a 20px thumb against its 12px. Fill, border, and shadow stay the
 * primitive's own: the Slider owns those, and DESIGN.md §12.1 keeps "no brand
 * hue" as an INTENTIONALLY UNDECIDED question — the contrast this control
 * needs already comes from the Ink range on the card behind it.
 */
const BOLD_SLIDER_CLASS = cn(
  "[&_[data-slot=slider-track]]:h-2.5!",
  "[&_[data-slot=slider-thumb]]:size-5!",
);

type EffortSelection = {
  levels: Array<EffortLevelResponse>;
  activeIndex: number;
  activeDisplay: string;
  activeHasLabel: boolean;
  pickEffort: (effort: string) => void;
};

/**
 * The active effort selection, reconciled against the displayed model's
 * vocabulary — null when that model declares none (renders nothing, per
 * `EffortSelector`'s own doc). Split out so that component composes only
 * markup, not this derivation.
 *
 * The level shown is the selection's own — the applied hold's effort, the
 * stored effort, or the model's default — and a slider move writes a pick, so
 * only an owner pick ever reaches a send.
 */
function useActiveEffortSelection(): EffortSelection | null {
  const { pickEffort } = useChatContext();
  const { model, effort } = useComposerSelection();

  const reasoning = model?.reasoning;
  const levels = reasoning?.effortLevels;

  if (!reasoning || !levels || levels.length === 0) return null;

  const activeLevel =
    effort !== undefined && levels.some((level) => level.value === effort)
      ? effort
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
    pickEffort,
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
      className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-between px-1.5"
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
  pickEffort: (effort: string) => void;
};

/** The slider plus its decorative stop markers — split out from the popover
 *  content around it since it owns its own value-change wiring. */
function EffortSelectorSlider({
  levels,
  activeIndex,
  pickEffort,
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
          if (level !== undefined) pickEffort(level.value);
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
  pickEffort,
}: {
  levels: Array<EffortLevelResponse>;
  activeIndex: number;
  activeDisplay: string;
  pickEffort: (effort: string) => void;
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
          pickEffort={pickEffort}
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

  const { levels, activeIndex, activeDisplay, activeHasLabel, pickEffort } =
    selection;

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
        pickEffort={pickEffort}
      />
    </Popover>
  );
}
