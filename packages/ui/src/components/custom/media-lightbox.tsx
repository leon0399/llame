"use client";

import { useMemo, useState } from "react";
import Lightbox, { type SlotStyles } from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";

/** Which stored variant of an image the lightbox shows. */
export type MediaLightboxVariant = "original" | "model";

/** One stored variant of an image: its URL, pixel size, and media type, so
 *  the shown image and its caption always describe the same bytes. */
export type MediaLightboxImage = {
  src: string;
  width: number;
  height: number;
  /** e.g. `image/png`. */
  mediaType: string;
};

/** One image in the lightbox, with both stored variants. */
export type MediaLightboxSlide = {
  /** The original bytes. */
  original: MediaLightboxImage;
  /** The model variant (the bytes the model receives). */
  model: MediaLightboxImage;
  /** Where the image came from: `upload`, `read`, or `prompt-import`. */
  provenance: string;
  /** The image's `media://` locator. */
  locator: string;
  /** Accessible description of the image. */
  alt: string;
};

/** Props for {@link MediaLightbox}. */
export type MediaLightboxProps = {
  /** Every image the lightbox can move between, in display order. */
  slides: ReadonlyArray<MediaLightboxSlide>;
  /** Slide to open on; `null` keeps the lightbox closed. */
  index: number | null;
  /** Called once the lightbox has closed (Escape, close button, backdrop). */
  onClose: () => void;
};

// The library's colors resolved to the system's semantic tokens, so the
// lightbox follows light/dark mode like every other overlay. Its default
// drop-shadow on buttons is dropped (DESIGN.md §5: no heavy shadows).
const lightboxStyles: SlotStyles = {
  root: {
    "--yarl__color_backdrop": "var(--background)",
    "--yarl__color_button": "var(--muted-foreground)",
    "--yarl__color_button_active": "var(--foreground)",
    "--yarl__color_button_disabled":
      "color-mix(in oklab, var(--muted-foreground) 40%, transparent)",
    "--yarl__button_filter": "none",
    "--yarl__slide_icon_loading_color": "var(--muted-foreground)",
    "--yarl__slide_icon_error_color": "var(--destructive)",
  },
};

const zoomSettings = { scrollToZoom: true, maxZoomPixelRatio: 8 };

type MediaLightboxControlsProps = {
  slide: MediaLightboxSlide;
  variant: MediaLightboxVariant;
  onVariantChange: (variant: MediaLightboxVariant) => void;
};

function MediaLightboxControls({
  slide,
  variant,
  onVariantChange,
}: MediaLightboxControlsProps) {
  const shown = slide[variant];
  return (
    // Arrow keys inside the segmented control move between its items; stop
    // them here so the lightbox does not also change slides. The div itself
    // is not interactive.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="absolute inset-x-0 bottom-0 flex justify-center p-4"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.stopPropagation();
        }
      }}
    >
      <div className="flex max-w-full flex-col items-center gap-2 rounded-xl border bg-popover px-3 py-2 text-popover-foreground shadow-sm">
        <ToggleGroup
          aria-label="Image variant"
          variant="outline"
          size="sm"
          spacing={0}
          value={[variant]}
          onValueChange={(value: Array<unknown>) => {
            const next = value[0];
            if (next === "original" || next === "model") onVariantChange(next);
          }}
        >
          <ToggleGroupItem value="original">Original</ToggleGroupItem>
          <ToggleGroupItem value="model">Model</ToggleGroupItem>
        </ToggleGroup>
        <p
          aria-live="polite"
          className="text-center font-mono text-xs break-all text-muted-foreground"
        >
          {`${shown.width}×${shown.height} ${shown.mediaType.replace(/^image\//, "").toUpperCase()} · ${slide.provenance} · ${slide.locator}`}
        </p>
      </div>
    </div>
  );
}

type OpenMediaLightboxProps = Omit<MediaLightboxProps, "index"> & {
  initialIndex: number;
};

function OpenMediaLightbox({
  slides,
  initialIndex,
  onClose,
}: OpenMediaLightboxProps) {
  const [variant, setVariant] = useState<MediaLightboxVariant>("model");
  const [viewIndex, setViewIndex] = useState(initialIndex);
  const librarySlides = useMemo(
    () => slides.map((slide) => ({ ...slide[variant], alt: slide.alt })),
    [slides, variant],
  );
  // The library resets to its `index` prop whenever `slides` changes, so the
  // viewed index is fed back in; toggling the variant keeps the current slide.
  const current = Math.min(viewIndex, slides.length - 1);
  const slide = slides[current];
  if (!slide) return null;
  return (
    <Lightbox
      open
      close={onClose}
      index={current}
      slides={librarySlides}
      plugins={[Zoom]}
      zoom={zoomSettings}
      carousel={{ finite: true }}
      on={{ view: ({ index }) => setViewIndex(index) }}
      styles={lightboxStyles}
      render={{
        controls: () => (
          <MediaLightboxControls
            slide={slide}
            variant={variant}
            onVariantChange={setVariant}
          />
        ),
      }}
    />
  );
}

/**
 * MediaLightbox shows chat images full-screen with wheel and pinch zoom, arrow
 * key navigation, and a segmented control that switches between the stored
 * `original` and `model` variants. The caption names the shown variant's
 * dimensions and format, the provenance, and the `media://` locator. Escape
 * closes it and returns focus to the element that opened it, so open it from
 * a focusable control such as a thumbnail button.
 *
 * Wraps [yet-another-react-lightbox](https://yet-another-react-lightbox.com)
 * and its Zoom plugin (`scrollToZoom`, `maxZoomPixelRatio: 8`, so images
 * smaller than the viewport still zoom). Each open starts on the `model`
 * variant.
 *
 * @summary for viewing chat images full-screen with zoom and variant switching
 */
export function MediaLightbox({ slides, index, onClose }: MediaLightboxProps) {
  if (index === null) return null;
  // Keyed by the opening index so every open starts fresh on that slide.
  return (
    <OpenMediaLightbox
      key={index}
      slides={slides}
      initialIndex={index}
      onClose={onClose}
    />
  );
}
