import { useQuery } from "@tanstack/react-query";

import { listPins as listPinsEndpoint } from "../../api/generated/pins/pins";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import type { PinnedItem } from "./types";

// Serializable-array key factory (TkDodo's "Effective React Query Keys"),
// same convention as chatQueryKeys / projectQueryKeys.
export const pinQueryKeys = {
  all: ["pins"] as const,
  list: () => [...pinQueryKeys.all, "list"] as const,
};

export const fetchPins = (): Promise<Array<PinnedItem>> =>
  listPinsEndpoint(
    undefined,
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );

/**
 * The caller's pinned items, mixed chats+projects, most-recently-pinned first
 * (server order — pins is the sole source of pin truth, design D5). This is
 * the ONE query both the rail's Pinned section and every item list's Pinned
 * group compose from.
 */
export function usePins() {
  return useQuery({
    queryKey: pinQueryKeys.list(),
    queryFn: fetchPins,
  });
}

/**
 * Chat id -> pinnedAt, for the chat list's "Pinned" grouping (design D5): a
 * chat is pinned iff its id appears here, ordered by the map's value (pin
 * recency), not the chat's own updatedAt.
 */
export function selectPinnedChatMap(
  pins: Array<PinnedItem> | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const pin of pins ?? []) {
    if (pin.itemType === "chat") map.set(pin.itemId, pin.pinnedAt);
  }
  return map;
}

/** Project id -> pinnedAt, for the project list's "Pinned" grouping (design D5). */
export function selectPinnedProjectMap(
  pins: Array<PinnedItem> | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const pin of pins ?? []) {
    if (pin.itemType === "project") map.set(pin.itemId, pin.pinnedAt);
  }
  return map;
}
