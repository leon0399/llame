import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "@workspace/ui/lib/utils";

/**
 * Slider picks a value by dragging a thumb along a track. Supply `value` +
 * `onValueChange` for a controlled slider, or `defaultValue` for an
 * uncontrolled one; pass an array of either to render a range with one thumb
 * per entry.
 *
 * For a small set of ordered named choices, drive it by INDEX (`min={0}`,
 * `max={options.length - 1}`, `step={1}`) — a slider says the options lie on
 * one scale, which a select does not.
 *
 * The thumb is keyboard-operable (arrows step, Home/End jump) because the
 * primitive makes it so; do not swap it for a styled div.
 *
 * Vendored from the [shadcn/ui Slider](https://ui.shadcn.com/docs/components/slider).
 *
 * @summary for choosing a value along an ordered range
 */
function Slider({
  className,
  /** Uncontrolled starting value. Use `value` instead for a controlled slider. */
  defaultValue,
  /** Controlled value. Pair with `onValueChange`. */
  value,
  /** Lowest selectable value. Defaults to 0. */
  min = 0,
  /** Highest selectable value. Defaults to 100. */
  max = 100,
  /**
   * Accessible name for the control. REQUIRED unless `aria-labelledby` points
   * at a visible label — the interactive element is a hidden `<input
   * type="range">`, and an unnamed form control is an axe violation.
   */
  "aria-label": ariaLabel,
  /** Id of the element naming this control, as an alternative to `aria-label`. */
  "aria-labelledby": ariaLabelledBy,
  ...props
}: SliderPrimitive.Root.Props) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max];

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-muted select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            // Forked from the registry output on purpose: the accessible name
            // has to land on the Thumb, which merges it into the hidden
            // `<input type="range">` that is the real control. Root spreads
            // onto a wrapper div, so a name passed there never reaches the
            // input and every story fails "Form elements must have labels".
            // Re-apply this when re-running `shadcn add slider`.
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            className="relative block size-3 shrink-0 rounded-full border border-ring bg-white ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
