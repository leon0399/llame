import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { getApiErrorStatus } from "../../api/errors";
import {
  pinItem as pinItemEndpoint,
  reorderPins as reorderPinsEndpoint,
  unpinItem as unpinItemEndpoint,
} from "../../api/generated/pins/pins";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import { toast } from "@workspace/ui/components/sonner";
import { chatQueryKeys } from "../chat/queries";
import { projectQueryKeys } from "../project/queries";
import { pinQueryKeys } from "./queries";
import type {
  ChatRefCard,
  PinItemType,
  PinnedItem,
  ProjectRefCard,
} from "./types";

/**
 * Pin/unpin mutations via the unified, idempotent PUT/DELETE
 * /api/v1/pins/:itemType/:itemId resource (design D2). Pins is the sole
 * source of pin truth (D5) — these are the only two places pin state
 * changes on the client.
 *
 * Optimistic pin SYNTHESIZES the card (design D5a): the rail renders from
 * the embedded RefCard, so an optimistic insert needs one — the caller
 * already has the item on screen (that's what they clicked pin on), so it
 * supplies the card. Optimistic unpin is a plain removal. Both invalidate
 * the affected item's own list query on settle, so that list's "Pinned"
 * group (derived from the pins set, not a field on the resource) re-buckets.
 */

function invalidateItemList(queryClient: QueryClient, itemType: PinItemType) {
  switch (itemType) {
    case "chat":
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
      break;
    case "project":
      queryClient.invalidateQueries({ queryKey: projectQueryKeys.lists() });
      break;
    default: {
      // Exhaustiveness guard: adding a value to PinItemType makes this a
      // compile error until the new type's list invalidation is wired.
      const _exhaustive: never = itemType;
      throw new Error(`Unhandled pin item type: ${String(_exhaustive)}`);
    }
  }
}

export async function pinItem(
  itemType: PinItemType,
  itemId: string,
): Promise<PinnedItem> {
  return pinItemEndpoint(
    itemType,
    itemId,
    undefined,
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );
}

type PinVariables =
  | { itemType: "chat"; itemId: string; card: ChatRefCard }
  | { itemType: "project"; itemId: string; card: ProjectRefCard };

function toOptimisticPinnedItem(vars: PinVariables): PinnedItem {
  const pinnedAt = new Date().toISOString();
  switch (vars.itemType) {
    case "chat":
      return {
        itemType: "chat",
        itemId: vars.itemId,
        pinnedAt,
        item: vars.card,
      };
    case "project":
      return {
        itemType: "project",
        itemId: vars.itemId,
        pinnedAt,
        item: vars.card,
      };
  }
}

export function usePinItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: PinVariables) => pinItem(vars.itemType, vars.itemId),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: pinQueryKeys.list() });
      const previous = queryClient.getQueryData<Array<PinnedItem>>(
        pinQueryKeys.list(),
      );
      const optimisticPin = toOptimisticPinnedItem(vars);
      queryClient.setQueryData<Array<PinnedItem>>(
        pinQueryKeys.list(),
        (old) => {
          const withoutExisting = (old ?? []).filter(
            (pin) =>
              !(pin.itemType === vars.itemType && pin.itemId === vars.itemId),
          );
          return [optimisticPin, ...withoutExisting];
        },
      );
      return { previous };
    },
    onError: (_error, vars, context) => {
      // Unconditional restore: context.previous is undefined when the pins
      // query was never fetched; a guarded restore would strand the optimistic
      // entry in cache until the next refetch.
      queryClient.setQueryData(pinQueryKeys.list(), context?.previous);
      toast.error(
        vars.itemType === "chat"
          ? "Couldn't pin the chat."
          : "Couldn't pin the project.",
      );
    },
    onSettled: (_data, _error, vars) => {
      queryClient.invalidateQueries({ queryKey: pinQueryKeys.list() });
      invalidateItemList(queryClient, vars.itemType);
    },
  });
}

export async function unpinItem(
  itemType: PinItemType,
  itemId: string,
): Promise<void> {
  try {
    await unpinItemEndpoint(
      itemType,
      itemId,
      undefined,
      createAuthenticatedBrowserFetch(globalThis.fetch),
    );
  } catch (error) {
    // 404 = already unpinned (e.g. a double-click's second request). That IS
    // the desired end state, so treat unpin as idempotent rather than erroring
    // — mirrors deleteChat/deleteProject's own 404-as-success handling.
    if (getApiErrorStatus(error) === 404) return;
    throw error;
  }
}

type UnpinVariables = { itemType: PinItemType; itemId: string };

export function useUnpinItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: UnpinVariables) => unpinItem(vars.itemType, vars.itemId),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: pinQueryKeys.list() });
      const previous = queryClient.getQueryData<Array<PinnedItem>>(
        pinQueryKeys.list(),
      );
      queryClient.setQueryData<Array<PinnedItem>>(pinQueryKeys.list(), (old) =>
        (old ?? []).filter(
          (pin) =>
            !(pin.itemType === vars.itemType && pin.itemId === vars.itemId),
        ),
      );
      return { previous };
    },
    onError: (_error, vars, context) => {
      // Unconditional restore: context.previous is undefined when the pins
      // query was never fetched; a guarded restore would strand the optimistic
      // entry in cache until the next refetch.
      queryClient.setQueryData(pinQueryKeys.list(), context?.previous);
      toast.error(
        vars.itemType === "chat"
          ? "Couldn't unpin the chat."
          : "Couldn't unpin the project.",
      );
    },
    onSettled: (_data, _error, vars) => {
      queryClient.invalidateQueries({ queryKey: pinQueryKeys.list() });
      invalidateItemList(queryClient, vars.itemType);
    },
  });
}

export async function reorderPins(
  items: Array<PinnedItem>,
): Promise<Array<PinnedItem>> {
  return reorderPinsEndpoint(
    {
      items: items.map((pin) => ({
        itemType: pin.itemType,
        itemId: pin.itemId,
      })),
    },
    undefined,
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );
}

export const pinMutationKeys = {
  all: ["pins", "mutations"] as const,
  reorder: () => [...pinMutationKeys.all, "reorder"] as const,
};

/**
 * Persist a full-list pin reorder from the main rail. Optimistically rewrites
 * the pins cache and invalidates type-filtered pinned list queries so chat/
 * project sidebars ripple without their own DnD.
 *
 * Scoped so rapid successive drags run in series — full-list replace makes
 * last-write-wins only hold when earlier requests finish before later ones
 * start (same discipline as personalization / org-units tree mutations).
 */
export function useReorderPins() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: pinMutationKeys.reorder(),
    scope: { id: "pins-reorder" },
    mutationFn: (items: Array<PinnedItem>) => reorderPins(items),
    onMutate: async (items) => {
      await queryClient.cancelQueries({ queryKey: pinQueryKeys.list() });
      const previous = queryClient.getQueryData<Array<PinnedItem>>(
        pinQueryKeys.list(),
      );
      queryClient.setQueryData<Array<PinnedItem>>(pinQueryKeys.list(), items);
      return { previous };
    },
    onError: (_error, _items, context) => {
      queryClient.setQueryData(pinQueryKeys.list(), context?.previous);
      toast.error("Couldn't reorder pinned items.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: pinQueryKeys.list() });
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectQueryKeys.lists() });
    },
  });
}
