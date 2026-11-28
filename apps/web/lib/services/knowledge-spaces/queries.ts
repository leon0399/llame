import {
  type InfiniteData,
  type QueryKey,
  useInfiniteQuery,
} from "@tanstack/react-query";

import { listKnowledgeSpaces } from "../../api/generated/knowledge/knowledge";
import type { KnowledgeSpaceCollectionResponse } from "../../api/generated/models";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

/** Spaces per page. The API caps a page at 100 and defaults to 50. */
export const KNOWLEDGE_SPACE_PAGE_SIZE = 50;

export const knowledgeSpaceQueryKeys = {
  all: ["knowledge-spaces"] as const,
  lists: () => [...knowledgeSpaceQueryKeys.all, "list"] as const,
  list: (archived?: "only" | "with") =>
    [...knowledgeSpaceQueryKeys.lists(), archived ?? "active"] as const,
};

function authenticatedFetch(): typeof fetch {
  return createAuthenticatedBrowserFetch(globalThis.fetch);
}

/**
 * The owner's Knowledge Spaces, oldest first, one cursor page at a time.
 * Omit `archived` for the working list. `only` is the archived view.
 * `with` is both.
 */
export function useKnowledgeSpacesQuery(archived?: "only" | "with") {
  return useInfiniteQuery<
    KnowledgeSpaceCollectionResponse,
    Error,
    InfiniteData<KnowledgeSpaceCollectionResponse, string | undefined>,
    QueryKey,
    string | undefined
  >({
    queryKey: knowledgeSpaceQueryKeys.list(archived),
    queryFn: ({ pageParam, signal }) =>
      listKnowledgeSpaces(
        {
          limit: KNOWLEDGE_SPACE_PAGE_SIZE,
          after: pageParam,
          archived,
        },
        { signal },
        authenticatedFetch(),
      ),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
