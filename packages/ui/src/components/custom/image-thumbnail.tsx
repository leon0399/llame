"use client";

import * as React from "react";
import { CircleAlertIcon, RotateCwIcon, XIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";

/** Upload lifecycle of one thumbnail; sent images are always `ready`. */
export type ImageThumbnailStatus = "ready" | "uploading" | "failed";

/** One image in an {@link ImageThumbnailRow}. */
export type ImageThumbnailItem = {
  /** Stable identity across reorders; also the drag and focus handle. */
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
  /** Activates the image. Its presence, or `focusable`, makes the image a button. */
  onOpen?: () => void;
  /** Shows a remove action, revealed on hover and on keyboard focus. */
  onRemove?: () => void;
  /** Retry action offered by the `failed` overlay. */
  onRetry?: () => void;
  /** Makes the image a keyboard focus stop even without `onOpen`. */
  focusable?: boolean;
  /** The image button, for callers that move focus (reorder). */
  buttonRef?: React.Ref<HTMLButtonElement>;
  /** Key handling on the image button (reorder shortcuts). */
  onButtonKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
  /** Keyboard shortcuts the image button answers to, announced to assistive tech. */
  keyShortcuts?: string;
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

type ThumbnailSurfaceProps = Omit<
  ImageThumbnailProps,
  "status" | "onRemove" | "onRetry"
>;

/** The image itself: a button when it can be activated or focused, else a
 *  plain decorative surface. */
function ThumbnailSurface({
  src,
  alt,
  onOpen,
  focusable,
  buttonRef,
  onButtonKeyDown,
  keyShortcuts,
}: ThumbnailSurfaceProps) {
  if (!onOpen && !focusable) return <ThumbnailImage src={src} alt={alt} />;
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-keyshortcuts={keyShortcuts}
      onClick={onOpen}
      onKeyDown={onButtonKeyDown}
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

/** Drag reorder over native HTML5 drag events: the dragged tile's index is
 *  held here, so drops of foreign data (files) fall through to the caller. */
function useDragReorder(
  onReorder: ((from: number, to: number) => void) | undefined,
) {
  const dragFrom = React.useRef<number | null>(null);
  return (index: number) =>
    onReorder
      ? {
          draggable: true,
          onDragStart: (event: React.DragEvent) => {
            dragFrom.current = index;
            event.dataTransfer.effectAllowed = "move";
          },
          onDragOver: (event: React.DragEvent) => {
            if (dragFrom.current === null) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          },
          onDrop: (event: React.DragEvent) => {
            const from = dragFrom.current;
            if (from === null) return;
            event.preventDefault();
            event.stopPropagation();
            dragFrom.current = null;
            if (from !== index) onReorder(from, index);
          },
          onDragEnd: () => {
            dragFrom.current = null;
          },
        }
      : {};
}

/** Keeps keyboard focus in the row across edits that re-render it: React may
 *  move the focused node in the DOM or unmount it, which blurs it, so the key
 *  to focus is held until the next commit and its image button focused then,
 *  unless focus has already landed elsewhere. */
function useRowFocus() {
  const buttons = React.useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = React.useRef<string | null>(null);

  React.useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      buttons.current.get(pendingFocus.current)?.focus();
    }
    pendingFocus.current = null;
  });

  const refFor = (key: string) => (node: HTMLButtonElement | null) => {
    if (node) buttons.current.set(key, node);
    else buttons.current.delete(key);
  };
  const focusAfterCommit = (key: string | undefined) => {
    pendingFocus.current = key ?? null;
  };
  return { refFor, focusAfterCommit };
}

/** `Alt+ArrowLeft/Right` reorder handlers that keep focus on the moved tile. */
function keyboardReorder(
  items: ReadonlyArray<ImageThumbnailItem>,
  onReorder: ((from: number, to: number) => void) | undefined,
  focusAfterCommit: (key: string | undefined) => void,
) {
  return (index: number) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!onReorder || !event.altKey) return;
    let delta = 0;
    if (event.key === "ArrowLeft") delta = -1;
    if (event.key === "ArrowRight") delta = 1;
    if (delta === 0) return;
    event.preventDefault();
    const to = index + delta;
    if (to < 0 || to >= items.length) return;
    focusAfterCommit(items[index]?.key);
    onReorder(index, to);
  };
}

/** Remove and retry handlers for the tile at `index` that keep focus in the
 *  row: remove moves it to the next tile (else the previous), retry keeps it
 *  on the retried tile once its failed overlay goes. */
function focusKeepingEdits(
  items: ReadonlyArray<ImageThumbnailItem>,
  { onRemove, onRetry }: Pick<ImageThumbnailRowProps, "onRemove" | "onRetry">,
  focusAfterCommit: (key: string | undefined) => void,
) {
  return (key: string, index: number) => ({
    onRemove:
      onRemove &&
      (() => {
        focusAfterCommit((items[index + 1] ?? items[index - 1])?.key);
        onRemove(key);
      }),
    onRetry:
      onRetry &&
      (() => {
        focusAfterCommit(key);
        onRetry(key);
      }),
  });
}

export interface ImageThumbnailRowProps {
  /** The images, in order. */
  items: ReadonlyArray<ImageThumbnailItem>;
  /** Activates an image by key. */
  onOpen?: (key: string) => void;
  /** Removes an image by key; enables the remove action on every tile. */
  onRemove?: (key: string) => void;
  /** Retries a failed upload by key. */
  onRetry?: (key: string) => void;
  /** Moves the image at `from` to index `to`; enables drag and `Alt+←/→`. */
  onReorder?: (from: number, to: number) => void;
  /** Accessible name of the list. */
  "aria-label"?: string;
  className?: string;
}

/**
 * A wrapping row of {@link ImageThumbnail}s. With `onReorder`, tiles reorder
 * by drag and by `Alt+ArrowLeft`/`Alt+ArrowRight` on the focused tile, which
 * keeps focus; removing a tile moves focus to the next tile (else the
 * previous; none when the row empties), and retrying keeps it on the retried
 * tile. Without callbacks the row is a read-only preview of sent images.
 *
 * @summary for the composer's attachment row and a sent message's images
 */
export function ImageThumbnailRow({
  items,
  onOpen,
  onRemove,
  onRetry,
  onReorder,
  "aria-label": ariaLabel,
  className,
}: ImageThumbnailRowProps) {
  const dragProps = useDragReorder(onReorder);
  const { refFor, focusAfterCommit } = useRowFocus();
  const keyDownFor = keyboardReorder(items, onReorder, focusAfterCommit);
  const editsFor = focusKeepingEdits(
    items,
    { onRemove, onRetry },
    focusAfterCommit,
  );
  return (
    <ul
      aria-label={ariaLabel}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {items.map((item, index) => (
        <li key={item.key} {...dragProps(index)}>
          <ImageThumbnail
            src={item.src}
            alt={item.alt}
            status={item.status}
            focusable={onReorder !== undefined}
            onOpen={onOpen && (() => onOpen(item.key))}
            {...editsFor(item.key, index)}
            buttonRef={refFor(item.key)}
            onButtonKeyDown={keyDownFor(index)}
            keyShortcuts={onReorder && "Alt+ArrowLeft Alt+ArrowRight"}
          />
        </li>
      ))}
    </ul>
  );
}
