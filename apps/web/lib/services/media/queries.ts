import {
  type InfiniteData,
  type QueryKey,
  useInfiniteQuery,
} from "@tanstack/react-query";

import { listMedia } from "../../api/generated/media/media";
import type { MediaPageResponse } from "../../api/generated/models";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

// Serializable-array key factory: generic resource → the caller's list.
export const mediaQueryKeys = {
  all: ["media"] as const,
  list: () => [...mediaQueryKeys.all, "list"] as const,
};

/** Media per gallery page; the API caps a page at 100. */
export const MEDIA_GALLERY_PAGE_SIZE = 48;

/**
 * The caller's media, newest first, one cursor page at a time: each page's
 * `nextCursor` is the next page's `before`, and a null cursor ends the list.
 */
export function useMediaGalleryQuery() {
  return useInfiniteQuery<
    MediaPageResponse,
    Error,
    InfiniteData<MediaPageResponse, string | undefined>,
    QueryKey,
    string | undefined
  >({
    queryKey: mediaQueryKeys.list(),
    queryFn: ({ pageParam, signal }) =>
      listMedia(
        { limit: MEDIA_GALLERY_PAGE_SIZE, before: pageParam },
        { signal },
        createAuthenticatedBrowserFetch(globalThis.fetch),
      ),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
