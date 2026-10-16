"use client";

import { useState } from "react";
import { AtSignIcon } from "lucide-react";

import { MediaThumbnail } from "@workspace/ui/components/custom/media-thumbnail";
import {
  ImageDimensionsTile,
  type MediaImageSize,
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

/** An imported image's thumbnail and its lightbox slide. */
type ImportedImage = {
  thumbnail: { src: string; alt: string };
  slide: MediaLightboxSlide;
};

/** An imported image's thumbnail and lightbox slide, or `null` when the
 *  entry is not one: a stored image opens its original, captioned with its
 *  `media://` locator; an unstored one opens its inline thumbnail, captioned
 *  with the original's size and the locator as written. */
function importedImage(entry: ImportEntry, key: string): ImportedImage | null {
  // PDFs have document tiles, never image variants or lightbox slides.
  if ("kind" in entry) return null;
  const alt = entry.locator;
  if ("media" in entry) {
    const sources = storedImageSources(entry.media);
    if (sources === null) return null;
    const caption = mediaCaption(entry.media);
    return {
      thumbnail: { src: sources.thumbnail, alt },
      slide: { key, src: sources.original, alt, caption },
    };
  }
  if (!("thumbnail" in entry) || entry.thumbnail === undefined) return null;
  const caption = mediaCaption(entry.locator, entry);
  return {
    thumbnail: { src: entry.thumbnail, alt },
    slide: { key, src: entry.thumbnail, alt, caption },
  };
}

/** One imported image preview, image dimensions tile, or PDF document tile. */
type ImportedTile =
  | { key: string; image: ImportedImage }
  | { key: string; pdf: { name: string; href?: string } }
  | { key: string; size: MediaImageSize };

/** An import's tile, or `null` for an entry that has none. */
function importedTile(entry: ImportEntry, key: string): ImportedTile | null {
  if ("kind" in entry) {
    return {
      key,
      pdf: {
        name: entry.locator,
        href:
          entry.media === undefined
            ? undefined
            : storedImageSources(entry.media)?.original,
      },
    };
  }
  const image = importedImage(entry, key);
  if (image !== null) return { key, image };
  if (!("width" in entry)) return null;
  const { width, height, mediaType } = entry;
  return { key, size: { width, height, mediaType } };
}

/** Imported media in entry order. Only images enter the lightbox; an
 *  unstored image without a thumbnail shows its dimensions, and an unstored
 *  PDF remains a static document tile. */
function ImportedMedia({ imports }: Pick<PromptImportsPayload, "imports">) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const tiles = imports.flatMap(
    (entry, index) => importedTile(entry, String(index)) ?? [],
  );
  if (tiles.length === 0) return null;
  return (
    <>
      <ul
        // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- WebKit drops the list role from a `list-style: none` list.
        role="list"
        aria-label="Imported media"
        className="my-1 flex flex-wrap gap-2"
      >
        {tiles.map((tile) => (
          <li key={tile.key}>
            {"image" in tile && (
              <MediaThumbnail
                kind="image"
                {...tile.image.thumbnail}
                onOpen={() => setOpenKey(tile.key)}
              />
            )}
            {"pdf" in tile && <MediaThumbnail kind="pdf" {...tile.pdf} />}
            {"size" in tile && <ImageDimensionsTile {...tile.size} />}
          </li>
        ))}
      </ul>
      <MediaLightbox
        slides={tiles.flatMap((tile) =>
          "image" in tile ? [tile.image.slide] : [],
        )}
        openKey={openKey}
        onOpenKeyChange={setOpenKey}
      />
    </>
  );
}

/**
 * The owner-facing chip for a `prompt-imports` context item: each import marker
 * a user prompt carried, marked when the result was truncated, denied by the
 * `read` permission group, failed to read, or omitted past a bound. An
 * imported image opens the chip's image lightbox. A stored PDF opens its
 * original in a new tab, while an unstored PDF remains a static tile. The
 * model text names denied, failed, and omitted targets only as not imported;
 * the outcomes and resolved paths shown here are owner-only and never reach a
 * public share. It renders at the top of the triggering user turn, live and
 * reloaded alike.
 *
 * @summary owner chip for imported, truncated, denied, failed, and omitted prompt files, images, and PDFs
 */
export function PromptImportsPart(payload: PromptImportsPayload) {
  return (
    <>
      <ContextChipGroup icon={<AtSignIcon />} label="Imports">
        {payload.imports.map((entry) => {
          const state: ContextFileState =
            entry.outcome === "imported" &&
            "truncated" in entry &&
            entry.truncated
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
      <ImportedMedia imports={payload.imports} />
    </>
  );
}
