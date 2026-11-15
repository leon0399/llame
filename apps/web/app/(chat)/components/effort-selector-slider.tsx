"use client";

import { Slider } from "@workspace/ui/components/slider";
import { cn } from "@workspace/ui/lib/utils";

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
  setSelectedEffort: (effort: string) => void;
};

/** The slider plus its decorative stop markers — split out from the popover
 *  content around it since it owns its own value-change wiring. */
export function EffortSelectorSlider({
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
