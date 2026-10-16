"use client";

import {
  CircleAlertIcon,
  FileTextIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";

/** Upload lifecycle of one thumbnail; sent media is always `ready`. */
export type MediaThumbnailStatus = "ready" | "uploading" | "failed";

/** Images load a preview; PDFs show a document icon and their name. */
type ThumbnailContent =
  | {
      /** Image preview. */
      kind: "image";
      /** Object URL while composing, or a stored image's model route. */
      src: string;
      /** Accessible image name, usually its file name. */
      alt: string;
    }
  | {
      /** PDF document tile; never loads an image route. */
      kind: "pdf";
      /** File name or source locator shown on the tile. */
      name: string;
      /** Stored original URL; omit for an unstored PDF. */
      href?: string;
    };

/** One image or PDF in a {@link MediaThumbnailRow}. */
export type MediaThumbnailItem = ThumbnailContent & {
  /** Stable identity of the attachment in the row. */
  key: string;
  /** Defaults to `ready`. */
  status?: MediaThumbnailStatus;
};

export type MediaThumbnailProps = ThumbnailContent & {
  /** Upload state; unfinished uploads cannot open. */
  status?: MediaThumbnailStatus;
  /** Activates a ready image; PDFs open their `href` instead. */
  onOpen?: () => void;
  /** Shows a remove action, revealed on hover and on keyboard focus. */
  onRemove?: () => void;
  /** Retry action offered by the `failed` overlay. */
  onRetry?: () => void;
};

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

/** A PDF's original opens in the browser's own viewer; unstored PDFs stay static. */
function PdfSurface({ name, href }: { name: string; href?: string }) {
  const content = (
    <div className="flex size-full flex-col items-center justify-center gap-1 p-1 text-foreground">
      <FileTextIcon aria-hidden="true" className="size-6" />
      <span className="w-full truncate text-center text-xs" title={name}>
        {name}
      </span>
    </div>
  );
  if (!href) return content;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${name} in a new tab`}
      className="block size-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      {content}
    </a>
  );
}

function ThumbnailSurface(
  props: ThumbnailContent & {
    status: MediaThumbnailStatus;
    onOpen?: () => void;
  },
) {
  if (props.kind === "pdf") {
    return (
      <PdfSurface
        name={props.name}
        href={props.status === "ready" ? props.href : undefined}
      />
    );
  }
  const { src, alt, onOpen, status } = props;
  if (!onOpen || status !== "ready")
    return <ThumbnailImage src={src} alt={alt} />;
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
 * A square image or PDF tile with upload state and an optional remove action.
 * Images activate the caller's viewer; stored PDFs open their original in a
 * new tab. Unstored PDFs and unfinished uploads cannot open.
 *
 * @summary for one image or PDF attachment with its upload state
 */
export function MediaThumbnail({
  status = "ready",
  onRemove,
  onRetry,
  ...surface
}: MediaThumbnailProps) {
  return (
    <div
      data-slot="media-thumbnail"
      data-status={status}
      className="group/thumbnail relative size-16 shrink-0 overflow-hidden rounded-xl border bg-muted"
    >
      <ThumbnailSurface {...surface} status={status} />
      {status === "uploading" && <UploadingOverlay />}
      {status === "failed" && <FailedOverlay onRetry={onRetry} />}
      {onRemove && (
        <RemoveButton
          alt={surface.kind === "image" ? surface.alt : surface.name}
          onRemove={onRemove}
        />
      )}
    </div>
  );
}

export interface MediaThumbnailRowProps {
  /** The images and PDFs, in attachment order. */
  items: ReadonlyArray<MediaThumbnailItem>;
  /** Activates an image by key; tiles still uploading or failed do not open. */
  onOpen?: (key: string) => void;
  /** Removes an attachment by key; enables its remove action. */
  onRemove?: (key: string) => void;
  /** Retries a failed upload by key. */
  onRetry?: (key: string) => void;
  /** Accessible name of the list. */
  "aria-label"?: string;
  className?: string;
}

/**
 * A wrapping row of {@link MediaThumbnail}s in attachment order. Ready images
 * activate `onOpen`; ready stored PDFs use their own original links.
 *
 * @summary for a composer's or sent message's image and PDF attachments
 */
export function MediaThumbnailRow({
  items,
  onOpen,
  onRemove,
  onRetry,
  "aria-label": ariaLabel,
  className,
}: MediaThumbnailRowProps) {
  return (
    <ul
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- WebKit drops the list role from a `list-style: none` list.
      role="list"
      aria-label={ariaLabel}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {items.map(({ key, ...item }) => (
        <li key={key}>
          <MediaThumbnail
            {...item}
            onOpen={onOpen && (() => onOpen(key))}
            onRemove={onRemove && (() => onRemove(key))}
            onRetry={onRetry && (() => onRetry(key))}
          />
        </li>
      ))}
    </ul>
  );
}
