"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  MediaLightbox,
  mediaCaption,
  type MediaLightboxSlide,
} from "@workspace/ui/components/custom/media-lightbox";
import {
  MediaThumbnail,
  type MediaThumbnailItem,
} from "@workspace/ui/components/custom/media-thumbnail";
import { Skeleton } from "@workspace/ui/components/skeleton";

import type { MediaPageResponse } from "@/lib/api/generated/models";
import { useMediaGalleryQuery } from "@/lib/services/media/queries";
import { storedImageSources } from "@/lib/services/media/urls";

const GRID_CLASS_NAME =
  "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";
const SKELETON_TILE_COUNT = 12;

/** The loaded pages as grid tiles and the image-only lightbox slides. An
 *  image tile previews its `/model` variant; a PDF tile links its
 *  `/original`. */
function galleryViews(pages: ReadonlyArray<MediaPageResponse>) {
  const items: Array<MediaThumbnailItem> = [];
  const slides: Array<MediaLightboxSlide> = [];
  for (const media of pages.flatMap((page) => page.items)) {
    const sources = storedImageSources(media.locator);
    if (sources === null) continue;
    if ("pages" in media) {
      items.push({
        key: media.id,
        kind: "pdf",
        name: media.name,
        href: sources.original,
      });
      continue;
    }
    items.push({
      key: media.id,
      kind: "image",
      src: sources.thumbnail,
      alt: media.name,
    });
    slides.push({
      key: media.id,
      src: sources.original,
      alt: media.name,
      caption: mediaCaption(media.locator, media),
    });
  }
  return { items, slides };
}

/** Fetches the next page whenever the sentinel scrolls into view, one page at
 *  a time. */
function useLoadMoreSentinel(query: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel === null || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) fetchNextPage();
      },
      // Start loading a screen ahead, so scrolling rarely meets the end.
      { rootMargin: "100% 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  return sentinelRef;
}

function GallerySkeleton() {
  return (
    <div className={GRID_CLASS_NAME} aria-label="Loading media">
      {Array.from({ length: SKELETON_TILE_COUNT }, (_, index) => (
        <Skeleton key={index} className="aspect-square w-full" />
      ))}
    </div>
  );
}

function GalleryMessage({
  children,
  onRetry,
}: {
  children: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
      <ImageIcon className="size-8" aria-hidden="true" />
      <p>{children}</p>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** The loaded tiles as square cards, and the lightbox their images open. */
function GalleryGrid({
  items,
  slides,
}: {
  items: ReadonlyArray<MediaThumbnailItem>;
  slides: ReadonlyArray<MediaLightboxSlide>;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <>
      <ul aria-label="Media" className={GRID_CLASS_NAME}>
        {items.map(({ key, ...item }) => (
          <li key={key}>
            <MediaThumbnail
              {...item}
              variant="grid"
              onOpen={() => setOpenKey(key)}
            />
          </li>
        ))}
      </ul>
      <MediaLightbox
        slides={slides}
        openKey={openKey}
        onOpenKeyChange={setOpenKey}
      />
    </>
  );
}

/**
 * The caller's images and PDFs, newest first, as square cards in a grid that
 * loads the next page as it scrolls into view. An image opens a lightbox over
 * the loaded images; a PDF opens its original in a new tab.
 */
export function MediaGallery() {
  const query = useMediaGalleryQuery();
  const sentinelRef = useLoadMoreSentinel(query);

  if (query.isPending) return <GallerySkeleton />;
  if (query.isError && query.data === undefined) {
    return (
      <GalleryMessage onRetry={() => void query.refetch()}>
        Could not load your media.
      </GalleryMessage>
    );
  }
  const { items, slides } = galleryViews(query.data.pages);
  if (items.length === 0) {
    return (
      <GalleryMessage>Images and PDFs you attach appear here.</GalleryMessage>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <GalleryGrid items={items} slides={slides} />
      <div ref={sentinelRef} aria-hidden="true" />
      {query.isFetchingNextPage && <GallerySkeleton />}
    </div>
  );
}
