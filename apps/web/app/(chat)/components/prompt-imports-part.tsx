"use client";

import { AtSignIcon } from "lucide-react";

import { ImageThumbnailRow } from "@workspace/ui/components/custom/image-thumbnail";

import type { PromptImportsPayload } from "@/lib/services/chat/history";
import { mediaVariantUrl } from "@/lib/services/media/urls";

import {
  ContextChipGroup,
  ContextFileChip,
  type ContextFileState,
} from "./context-file-chip";

type PromptImportsPartProps = PromptImportsPayload & {
  /** Opens the imported image at this index of `imports` (the chat's
   *  lightbox); without it the image thumbnails are read-only. */
  onOpenImage?: (entryIndex: number) => void;
};

/** The imported images as thumbnails under the chips, each loading its
 *  `/model` variant. */
function ImportedImages({
  imports,
  onOpenImage,
}: Pick<PromptImportsPartProps, "imports" | "onOpenImage">) {
  const items = imports.flatMap((entry, entryIndex) => {
    const src =
      entry.media === undefined ? null : mediaVariantUrl(entry.media, "model");
    if (src === null) return [];
    return [{ key: String(entryIndex), src, alt: entry.locator }];
  });
  if (items.length === 0) return null;
  return (
    <ImageThumbnailRow
      aria-label="Imported images"
      className="my-1"
      items={items}
      onOpen={onOpenImage && ((key) => onOpenImage(Number(key)))}
    />
  );
}

/**
 * The owner-facing chip for a `prompt-imports` context item: each import marker
 * a user prompt carried, marked when the result was truncated, denied by the
 * `read` permission group, failed to read, or omitted past a bound. An
 * imported image also shows its thumbnail, which opens the chat lightbox. The
 * model text names denied, failed, and omitted targets only as not imported;
 * the outcomes and resolved paths shown here are owner-only and never reach a
 * public share. It renders at the top of the triggering user turn, live and
 * reloaded alike.
 *
 * @summary owner chip for imported, truncated, denied, failed, and omitted prompt files and images
 */
export function PromptImportsPart({
  onOpenImage,
  ...payload
}: PromptImportsPartProps) {
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
      <ImportedImages imports={payload.imports} onOpenImage={onOpenImage} />
    </>
  );
}
