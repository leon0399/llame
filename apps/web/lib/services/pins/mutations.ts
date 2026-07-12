import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { HTTPError } from "ky";

import { api, buildApiUrl } from "../../api/client";
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
  return api
    .put(buildApiUrl(`/api/v1/pins/${itemType}/${itemId}`))
    .json<PinnedItem>();
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
      const previous = queryClient.getQueryData<PinnedItem[]>(
        pinQueryKeys.list(),
      );
      const optimisticPin = toOptimisticPinnedItem(vars);
      queryClient.setQueryData<PinnedItem[]>(pinQueryKeys.list(), (old) => {
        const withoutExisting = (old ?? []).filter(
          (pin) =>
            !(pin.itemType === vars.itemType && pin.itemId === vars.itemId),
        );
        return [optimisticPin, ...withoutExisting];
      });
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
    await api.delete(buildApiUrl(`/api/v1/pins/${itemType}/${itemId}`));
  } catch (error) {
    // 404 = already unpinned (e.g. a double-click's second request). That IS
    // the desired end state, so treat unpin as idempotent rather than erroring
    // — mirrors deleteChat/deleteProject's own 404-as-success handling.
    if (error instanceof HTTPError && error.response.status === 404) return;
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
      const previous = queryClient.getQueryData<PinnedItem[]>(
        pinQueryKeys.list(),
      );
      queryClient.setQueryData<PinnedItem[]>(pinQueryKeys.list(), (old) =>
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
