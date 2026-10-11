"use client";

import { useState } from "react";
import { AtSignIcon } from "lucide-react";

import {
  ImageThumbnailRow,
  type ImageThumbnailItem,
} from "@workspace/ui/components/custom/image-thumbnail";
import {
  ImageDimensionsTile,
  MediaLightbox,
  type MediaLightboxSlide,
  mediaCaption,
} from "@workspace/ui/components/custom/media-lightbox";

import type { PromptImportsPayload } from "@/lib/services/chat/history";
import { storedImageSources } from "@/lib/services/media/urls";

import {
  ContextChipGroup,
  ContextFileChip,
  type ContextFileState,
} from "./context-file-chip";

type ImportEntry = PromptImportsPayload["imports"][number];

/** An imported image's thumbnail and lightbox slide, or `null` when it has
 *  no thumbnail: a stored image opens its original, captioned with its
 *  `media://` locator; an unstored one opens its inline thumbnail, captioned
 *  with the original's size and the locator as written. */
function importedImage(
  entry: ImportEntry,
  key: string,
): { item: ImageThumbnailItem; slide: MediaLightboxSlide } | null {
  const alt = entry.locator;
  if (entry.media !== undefined) {
    const sources = storedImageSources(entry.media);
    if (sources === null) return null;
    const caption = mediaCaption(entry.media);
    return {
      item: { key, src: sources.thumbnail, alt },
      slide: { key, src: sources.original, alt, caption },
    };
  }
  if (entry.thumbnail === undefined) return null;
  const caption = mediaCaption(entry.locator, entry);
  return {
    item: { key, src: entry.thumbnail, alt },
    slide: { key, src: entry.thumbnail, alt, caption },
  };
}

/** The imported images under the chips, opening a lightbox over this chip's
 *  images; an unstored image without a thumbnail shows only its size. */
function ImportedImages({ imports }: Pick<PromptImportsPayload, "imports">) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const images = imports.flatMap(
    (entry, index) => importedImage(entry, String(index)) ?? [],
  );
  const sizeOnly = imports.flatMap((entry, index) =>
    entry.width !== undefined && entry.thumbnail === undefined
      ? [{ ...entry, key: String(index) }]
      : [],
  );
  if (images.length === 0 && sizeOnly.length === 0) return null;
  return (
    <div className="my-1 flex flex-wrap gap-2">
      {images.length > 0 && (
        <ImageThumbnailRow
          aria-label="Imported images"
          items={images.map(({ item }) => item)}
          onOpen={setOpenKey}
        />
      )}
      {sizeOnly.map(({ key, width, height, mediaType }) => (
        <ImageDimensionsTile
          key={key}
          width={width}
          height={height}
          mediaType={mediaType}
        />
      ))}
      <MediaLightbox
        slides={images.map(({ slide }) => slide)}
        openKey={openKey}
        onOpenKeyChange={setOpenKey}
      />
    </div>
  );
}

/**
 * The owner-facing chip for a `prompt-imports` context item: each import marker
 * a user prompt carried, marked when the result was truncated, denied by the
 * `read` permission group, failed to read, or omitted past a bound. An
 * imported image also shows its thumbnail, which opens a lightbox over the
 * chip's images. The
 * model text names denied, failed, and omitted targets only as not imported;
 * the outcomes and resolved paths shown here are owner-only and never reach a
 * public share. It renders at the top of the triggering user turn, live and
 * reloaded alike.
 *
 * @summary owner chip for imported, truncated, denied, failed, and omitted prompt files and images
 */
export function PromptImportsPart(payload: PromptImportsPayload) {
  return (
    <>
      <ContextChipGroup icon={<AtSignIcon />} label="Imports">
        {payload.imports.map((entry) => {
          const state: ContextFileState =
            entry.outcome === "imported" && entry.truncated
              ? "truncated"
              : entry.outcome;
          const detail =
            entry.resolved !== undefined && entry.resolved !== entry.locator
              ? `${entry.locator} → ${entry.resolved}`
              : undefined;

          return (
            <ContextFileChip
              key={`import:${entry.locator}`}
              kind="prompt"
              path={entry.locator}
              detail={detail}
              state={state}
            />
          );
        })}
        {(payload.omitted ?? []).map((locator) => (
          <ContextFileChip
            key={`omitted:${locator}`}
            kind="prompt"
            path={locator}
            state="omitted"
          />
        ))}
      </ContextChipGroup>
      <ImportedImages imports={payload.imports} />
    </>
  );
}
