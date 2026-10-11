"use client";

import { useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Maximize2Icon,
  Minimize2Icon,
} from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";

/** An image's pixel size and type, as a row already knows them. */
export type MediaImageSize = {
  width: number;
  height: number;
  /** e.g. `image/png`. */
  mediaType: string;
};

/** `W×H FORMAT`, e.g. `1600×900 PNG`. */
export function imageSizeLabel({
  width,
  height,
  mediaType,
}: MediaImageSize): string {
  const format = mediaType.replace(/^image\//, "").toUpperCase();
  return `${width}×${height} ${format}`;
}

/** A lightbox caption: the locator, prefixed with `W×H FORMAT · ` when the
 *  original's size is known. */
export function mediaCaption(locator: string, size?: MediaImageSize): string {
  return size ? `${imageSizeLabel(size)} · ${locator}` : locator;
}

/** One image in a {@link MediaLightbox}. */
export type MediaLightboxSlide = {
  /** Identity within the row, the same key the row's thumbnail opens. */
  key: string;
  /** The image shown. */
  src: string;
  /** Accessible description of the image. */
  alt: string;
  /** Text under the image, usually from {@link mediaCaption}. */
  caption: string;
};

/** Props for {@link MediaLightbox}. */
export type MediaLightboxProps = {
  /** The row's images, in display order. */
  slides: ReadonlyArray<MediaLightboxSlide>;
  /** The shown slide's key; `null`, or a key no slide has, keeps it closed. */
  openKey: string | null;
  /** Called with the neighbour's key on navigation and `null` on close. */
  onOpenKeyChange: (key: string | null) => void;
};

type LightboxSlideViewProps = {
  slide: MediaLightboxSlide;
  previous: MediaLightboxSlide | undefined;
  next: MediaLightboxSlide | undefined;
  onOpenKeyChange: (key: string) => void;
};

/** The image as a button toggling between fit and 100%, where the panel
 *  scrolls to pan. */
function ZoomableImage({
  slide,
  actualSize,
  onToggle,
}: {
  slide: MediaLightboxSlide;
  actualSize: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "block rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          actualSize ? "cursor-zoom-out" : "mx-auto cursor-zoom-in",
        )}
      >
        <img
          src={slide.src}
          alt={slide.alt}
          className={
            actualSize
              ? "max-w-none"
              : "max-h-[calc(90vh-5rem)] max-w-[calc(90vw-1rem)] object-contain"
          }
        />
      </button>
    </div>
  );
}

/** The image's dialog title and the image over its toolbar: previous and
 *  next (only in a row of several), the caption, and the fit/100% toggle. */
function LightboxSlideView({
  slide,
  previous,
  next,
  onOpenKeyChange,
}: LightboxSlideViewProps) {
  // Keyed by slide, so moving to another image starts it fitted again
  // without remounting the toolbar (which would drop focus).
  const [actualSizeKey, setActualSizeKey] = useState<string | null>(null);
  const actualSize = actualSizeKey === slide.key;
  const several = previous !== undefined || next !== undefined;
  const toggle = () => setActualSizeKey(actualSize ? null : slide.key);
  return (
    <>
      <DialogTitle className="sr-only">{slide.alt}</DialogTitle>
      <ZoomableImage slide={slide} actualSize={actualSize} onToggle={toggle} />
      <div className="flex items-center gap-2">
        {several && (
          <StepButton
            direction="previous"
            target={previous}
            onStep={onOpenKeyChange}
          />
        )}
        <DialogDescription className="flex-1 text-center font-mono text-xs break-all">
          {slide.caption}
        </DialogDescription>
        <ActualSizeButton pressed={actualSize} onToggle={toggle} />
        {several && (
          <StepButton direction="next" target={next} onStep={onOpenKeyChange} />
        )}
      </div>
    </>
  );
}

/** The fit/100% toggle beside the caption. */
function ActualSizeButton({
  pressed,
  onToggle,
}: {
  pressed: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Actual size"
      aria-pressed={pressed}
      onClick={onToggle}
    >
      {pressed ? <Minimize2Icon /> : <Maximize2Icon />}
    </Button>
  );
}

/** The previous or next button, a focusable no-op at the row's end, so a
 *  step onto the last image keeps focus (and the arrow keys) in the
 *  dialog. */
function StepButton({
  direction,
  target,
  onStep,
}: {
  direction: "previous" | "next";
  target: MediaLightboxSlide | undefined;
  onStep: (key: string) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={direction === "previous" ? "Previous image" : "Next image"}
      aria-disabled={target === undefined}
      className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
      onClick={() => target && onStep(target.key)}
    >
      {direction === "previous" ? <ArrowLeftIcon /> : <ArrowRightIcon />}
    </Button>
  );
}

/** The slide `openKey` names and its neighbours. */
function slideAt(
  slides: ReadonlyArray<MediaLightboxSlide>,
  openKey: string | null,
) {
  const index = slides.findIndex((slide) => slide.key === openKey);
  return {
    slide: slides[index],
    previous: index > 0 ? slides[index - 1] : undefined,
    next: index === -1 ? undefined : slides[index + 1],
  };
}

/**
 * MediaLightbox shows one row's images (a message's attachments, a read
 * result, a prompt-import chip, the composer's uploads) in a wide dialog,
 * with the caption under the image. ArrowLeft/ArrowRight and the arrow
 * buttons move within the row; clicking the image or the "Actual size"
 * button toggles between fitting the viewport and 100%, where the panel
 * scrolls to pan. Escape, the close button, or the backdrop close it, and
 * focus returns to the thumbnail that opened it.
 *
 * @summary for viewing a row of chat images in a dialog
 */
export function MediaLightbox({
  slides,
  openKey,
  onOpenKeyChange,
}: MediaLightboxProps) {
  const { slide, previous, next } = slideAt(slides, openKey);
  // The last shown slide stays rendered while the dialog animates out.
  const [shown, setShown] = useState(slide);
  if (slide !== undefined && slide !== shown) setShown(slide);
  return (
    <Dialog
      open={slide !== undefined}
      onOpenChange={(open) => {
        if (!open) onOpenKeyChange(null);
      }}
    >
      <DialogContent
        onKeyDown={(event) => {
          const target =
            (event.key === "ArrowLeft" && previous) ||
            (event.key === "ArrowRight" && next);
          if (!target) return;
          event.preventDefault();
          onOpenKeyChange(target.key);
        }}
        className="flex max-h-[90vh] w-auto max-w-[90vw] flex-col gap-2 p-2 sm:max-w-[90vw]"
      >
        {shown && (
          <LightboxSlideView
            slide={shown}
            previous={previous}
            next={next}
            onOpenKeyChange={onOpenKeyChange}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A thumbnail-sized tile naming an image's size and format, for an image
 * shown without a thumbnail (its inline thumbnail would have exceeded the
 * cap). It opens nothing.
 *
 * @summary for an image that has no thumbnail to show
 */
export function ImageDimensionsTile(size: MediaImageSize) {
  return (
    <div
      data-slot="image-dimensions-tile"
      className="flex size-16 shrink-0 items-center justify-center rounded-xl border bg-muted p-1 text-center font-mono text-[10px] break-all text-foreground"
    >
      {imageSizeLabel(size)}
    </div>
  );
}
