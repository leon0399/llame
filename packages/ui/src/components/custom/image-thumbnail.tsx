"use client";

import { CircleAlertIcon, RotateCwIcon, XIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";

/** Upload lifecycle of one thumbnail; sent images are always `ready`. */
export type ImageThumbnailStatus = "ready" | "uploading" | "failed";

/** One image in an {@link ImageThumbnailRow}. */
export type ImageThumbnailItem = {
  /** Stable identity of the image in the row. */
  key: string;
  /** Image URL: an object URL while composing, a media route once sent. */
  src: string;
  /** Accessible name of the image, usually its file name. */
  alt: string;
  /** Defaults to `ready`. */
  status?: ImageThumbnailStatus;
};

export interface ImageThumbnailProps {
  /** Image URL, loaded lazily. */
  src: string;
  /** Accessible name of the image, usually its file name. */
  alt: string;
  /** Upload state; `uploading` and `failed` cover the image with an overlay. */
  status?: ImageThumbnailStatus;
  /** Activates the image; its presence makes the image a button. */
  onOpen?: () => void;
  /** Shows a remove action, revealed on hover and on keyboard focus. */
  onRemove?: () => void;
  /** Retry action offered by the `failed` overlay. */
  onRetry?: () => void;
}

function ThumbnailImage({ src, alt }: { src: string; alt: string }) {
  return (
    // Plain <img>: the src is an object URL or a cookie-authenticated API
    // route, neither of which next/image can optimize or proxy.
    // oxlint-disable-next-line nextjs/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      className="size-full object-cover"
    />
  );
}

function UploadingOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/70">
      <Spinner aria-label="Uploading" className="size-5" />
    </div>
  );
}

function FailedOverlay({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-background/80 text-destructive">
      <CircleAlertIcon aria-hidden="true" className="size-4" />
      <span className="sr-only">Upload failed</span>
      {onRetry && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Retry upload"
          onClick={onRetry}
        >
          <RotateCwIcon aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

function RemoveButton({
  alt,
  onRemove,
}: {
  alt: string;
  onRemove: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-xs"
      aria-label={`Remove ${alt}`}
      onClick={onRemove}
      className="absolute top-1 right-1 opacity-0 group-hover/thumbnail:opacity-100 group-focus-within/thumbnail:opacity-100"
    >
      <XIcon aria-hidden="true" />
    </Button>
  );
}

/** The image itself: a button when it can be activated, else a plain
 *  decorative surface. */
function ThumbnailSurface({
  src,
  alt,
  onOpen,
}: Pick<ImageThumbnailProps, "src" | "alt" | "onOpen">) {
  if (!onOpen) return <ThumbnailImage src={src} alt={alt} />;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="size-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <ThumbnailImage src={src} alt={alt} />
    </button>
  );
}

/**
 * A square image tile for message attachments: shows the image, an
 * uploading or failed overlay, and an optional remove action that appears on
 * hover and on keyboard focus. Without callbacks it is a read-only preview.
 *
 * @summary for one attached image with its upload state
 */
export function ImageThumbnail({
  status = "ready",
  onRemove,
  onRetry,
  ...surface
}: ImageThumbnailProps) {
  return (
    <div
      data-slot="image-thumbnail"
      data-status={status}
      className="group/thumbnail relative size-16 shrink-0 overflow-hidden rounded-xl border bg-muted"
    >
      <ThumbnailSurface {...surface} />
      {status === "uploading" && <UploadingOverlay />}
      {status === "failed" && <FailedOverlay onRetry={onRetry} />}
      {onRemove && <RemoveButton alt={surface.alt} onRemove={onRemove} />}
    </div>
  );
}

export interface ImageThumbnailRowProps {
  /** The images, in order. */
  items: ReadonlyArray<ImageThumbnailItem>;
  /** Activates an image by key; tiles still uploading or failed do not open. */
  onOpen?: (key: string) => void;
  /** Removes an image by key; enables the remove action on every tile. */
  onRemove?: (key: string) => void;
  /** Retries a failed upload by key. */
  onRetry?: (key: string) => void;
  /** Accessible name of the list. */
  "aria-label"?: string;
  className?: string;
}

/**
 * A wrapping row of {@link ImageThumbnail}s in the given order. Without
 * callbacks the row is a read-only preview of sent images.
 *
 * @summary for the composer's attachment row and a sent message's images
 */
export function ImageThumbnailRow({
  items,
  onOpen,
  onRemove,
  onRetry,
  "aria-label": ariaLabel,
  className,
}: ImageThumbnailRowProps) {
  return (
    <ul
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- WebKit drops the list role from a `list-style: none` list.
      role="list"
      aria-label={ariaLabel}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {items.map((item) => (
        <li key={item.key}>
          <ImageThumbnail
            src={item.src}
            alt={item.alt}
            status={item.status}
            onOpen={
              onOpen && (item.status ?? "ready") === "ready"
                ? () => onOpen(item.key)
                : undefined
            }
            onRemove={onRemove && (() => onRemove(item.key))}
            onRetry={onRetry && (() => onRetry(item.key))}
          />
        </li>
      ))}
    </ul>
  );
}
