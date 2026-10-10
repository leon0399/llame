import { useCallback, useMemo } from "react";
import { type QueryObserverResult, useQueries } from "@tanstack/react-query";

import type { MediaLightboxSlide } from "@workspace/ui/components/custom/media-lightbox";

import { fetchMediaDescriptor } from "./descriptors";
import type { MediaDescriptor } from "./uploads";
import { mediaIdFromLocator, mediaVariantUrl } from "./urls";

/** A lightbox slide for a stored image: both variant routes, their sizes and
 *  formats, provenance, and locator, all from the image's descriptor. */
export function mediaLightboxSlide(
  descriptor: MediaDescriptor,
): MediaLightboxSlide | null {
  const originalSrc = mediaVariantUrl(descriptor.locator, "original");
  const modelSrc = mediaVariantUrl(descriptor.locator, "model");
  if (originalSrc === null || modelSrc === null) return null;
  return {
    original: {
      src: originalSrc,
      width: descriptor.width,
      height: descriptor.height,
      mediaType: descriptor.mediaType,
    },
    model: {
      src: modelSrc,
      width: descriptor.model.width,
      height: descriptor.model.height,
      mediaType: descriptor.model.mediaType,
    },
    provenance: descriptor.provenance,
    locator: descriptor.locator,
    alt: descriptor.name,
  };
}

/** One image occurrence a lightbox can show, identified by a caller key so
 *  the same stored image may appear more than once. */
export type MediaOccurrence = { key: string; locator: string };

export type MediaOccurrenceSlides = {
  /** Every occurrence whose descriptor loaded, in the given order. */
  slides: ReadonlyArray<MediaLightboxSlide>;
  /** The caller key of each slide, index-aligned with `slides`. */
  keys: ReadonlyArray<string>;
  /** Whether any descriptor is still loading. */
  pending: boolean;
};

/** The slides of the occurrences whose image (`ids[i]`'s descriptor is
 *  `results[i]`) has loaded, keeping the occurrences' order. */
function occurrenceSlides(
  occurrences: ReadonlyArray<MediaOccurrence>,
  ids: ReadonlyArray<string>,
  results: ReadonlyArray<QueryObserverResult<MediaDescriptor>>,
): MediaOccurrenceSlides {
  const byId = new Map(ids.map((id, index) => [id, results[index]?.data]));
  const slides: Array<MediaLightboxSlide> = [];
  const keys: Array<string> = [];
  for (const { key, locator } of occurrences) {
    const id = mediaIdFromLocator(locator);
    const descriptor = id === null ? undefined : byId.get(id);
    const slide = descriptor && mediaLightboxSlide(descriptor);
    if (!slide) continue;
    slides.push(slide);
    keys.push(key);
  }
  return {
    slides,
    keys,
    pending: results.some((result) => result.isPending),
  };
}

/**
 * Lightbox slides for `occurrences`, loading each distinct image's descriptor
 * (`GET /api/v1/media/:id`) only while `enabled`. A stored image never
 * changes, so a loaded descriptor never goes stale, and a failed load (an
 * unknown id) is permanent, so it is not retried. An occurrence whose
 * descriptor fails to load is left out.
 */
export function useMediaOccurrenceSlides(
  occurrences: ReadonlyArray<MediaOccurrence>,
  enabled: boolean,
): MediaOccurrenceSlides {
  const ids = useMemo(
    () => [
      ...new Set(
        occurrences.flatMap(({ locator }) => mediaIdFromLocator(locator) ?? []),
      ),
    ],
    [occurrences],
  );
  // Stable while the occurrences and results are, so the slides keep their
  // identity across unrelated renders.
  const combine = useCallback(
    (results: Array<QueryObserverResult<MediaDescriptor>>) =>
      occurrenceSlides(occurrences, ids, results),
    [ids, occurrences],
  );
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ["media", id],
      queryFn: () => fetchMediaDescriptor(id),
      staleTime: Number.POSITIVE_INFINITY,
      retry: false,
      enabled,
    })),
    combine,
  });
}
