import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import { activeRunsQueryKeys } from "../chat/active-runs";
import {
  chatListFiltersFromKey,
  chatQueryKeys,
  type ChatResponse,
} from "../chat/queries";
import type { ChatSearchResult } from "../chat/search";
import { pinQueryKeys } from "../pins/queries";
import type { PinnedItem } from "../pins/types";
import {
  projectListFiltersFromKey,
  projectQueryKeys,
} from "../project/queries";
import type { ProjectResponse } from "../project/types";
import type {
  ChatListItemResponse,
  LiveMessage,
} from "../../api/live-generated/live-protocol";

/**
 * Applies one live record update to the TanStack Query caches, so the UI
 * changes without refetching:
 *
 * - a chat or project record replaces its cached copy in every list whose
 *   filters it matches, is inserted where it now matches, and is removed
 *   where it no longer does; lists re-sort by `updatedAt`, except
 *   pinned-only lists, which keep pin order;
 * - pinned-item cards and search results take the new title or name;
 * - a deletion removes the record everywhere;
 * - `pins.replaced` replaces the pin list.
 *
 * A list whose membership depends on pin state the client does not have, and
 * any pin-filtered list after the pin set changes, is invalidated instead:
 * one refetch where client-side filtering could be wrong. Run messages are
 * handled by the active-runs provider.
 */
export function applyLiveMessage(
  queryClient: QueryClient,
  message: LiveMessage,
): void {
  switch (message.type) {
    case "chat.upserted":
      return applyChat(queryClient, message.chat);
    case "chat.deleted":
      return removeChat(queryClient, message.chatId);
    case "project.upserted":
      return applyProject(queryClient, message.project);
    case "project.deleted":
      return removeProject(queryClient, message.projectId);
    case "pins.replaced":
      return applyPins(queryClient, message.items);
    case "resync":
      return invalidateOwnerLists(queryClient);
    case "run.updated":
    case "run.progress":
      return;
  }
}

/** Every owner-level list a missed message could have changed. */
export function invalidateOwnerLists(queryClient: QueryClient): void {
  for (const queryKey of [
    chatQueryKeys.lists(),
    pinQueryKeys.list(),
    projectQueryKeys.lists(),
    activeRunsQueryKeys.all,
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

type PinFilter = "only" | "exclude" | "with" | undefined;
type Membership = boolean | "unknown";

/** Whether a record belongs in a list with these archive and pin filters. */
export function matchesListFilters(
  record: { id: string; archivedAt: string | null },
  filters: { archived?: "only" | "with"; pinned?: PinFilter },
  pinnedIds: ReadonlySet<string> | undefined,
): Membership {
  const archivedOk =
    filters.archived === "with" ||
    (filters.archived === "only"
      ? record.archivedAt !== null
      : record.archivedAt === null);
  if (!archivedOk) return false;
  if (filters.pinned !== "only" && filters.pinned !== "exclude") return true;
  if (!pinnedIds) return "unknown";
  return pinnedIds.has(record.id) === (filters.pinned === "only");
}

function pinnedIdSet(
  queryClient: QueryClient,
): ReadonlySet<string> | undefined {
  const pins = queryClient.getQueryData<Array<PinnedItem>>(pinQueryKeys.list());
  return pins && new Set(pins.map((pin) => pin.itemId));
}

/** `items` with `record` placed, replaced, or removed according to `member`. */
export function placeRecord<T extends { id: string; updatedAt: string }>(
  items: ReadonlyArray<T>,
  record: T,
  member: boolean,
  sortByUpdatedAt: boolean,
): Array<T> {
  const index = items.findIndex((item) => item.id === record.id);
  if (!member) return items.filter((item) => item.id !== record.id);
  if (index >= 0 && !sortByUpdatedAt) {
    return items.map((item) => (item.id === record.id ? record : item));
  }
  const rest = items.filter((item) => item.id !== record.id);
  if (!sortByUpdatedAt) return [record, ...rest];
  const at = rest.findIndex((item) => item.updatedAt < record.updatedAt);
  return at < 0
    ? [...rest, record]
    : [...rest.slice(0, at), record, ...rest.slice(at)];
}

function applyChat(queryClient: QueryClient, chat: ChatListItemResponse): void {
  const { lastMessage: _lastMessage, ...detail } = chat;
  queryClient.setQueryData(chatQueryKeys.detail(chat.id), detail);
  const pinnedIds = pinnedIdSet(queryClient);
  for (const [queryKey, data] of queryClient.getQueriesData<
    InfiniteData<Array<ChatResponse>>
  >({ queryKey: chatQueryKeys.lists() })) {
    const filters = chatListFiltersFromKey(queryKey);
    if (!filters || !data) continue;
    const member = matchesListFilters(chat, filters, pinnedIds);
    const inProject =
      filters.projectId === undefined || filters.projectId === chat.projectId;
    if (member === "unknown") {
      void queryClient.invalidateQueries({ queryKey, exact: true });
      continue;
    }
    const sorted = filters.pinned !== "only";
    queryClient.setQueryData<InfiniteData<Array<ChatResponse>>>(queryKey, {
      ...data,
      pages: data.pages.map((page, index) =>
        index === 0
          ? placeRecord(page, chat, member && inProject, sorted)
          : page.filter((item) => item.id !== chat.id),
      ),
    });
  }
  updateSearchResults(queryClient, chat.id, (result) => ({
    ...result,
    title: chat.title,
    updatedAt: chat.updatedAt,
  }));
  updatePinCards(queryClient, chat.id, (pin) =>
    pin.itemType === "chat"
      ? {
          ...pin,
          item: { ...pin.item, title: chat.title, archivedAt: chat.archivedAt },
        }
      : pin,
  );
}

function removeChat(queryClient: QueryClient, chatId: string): void {
  queryClient.removeQueries({
    queryKey: chatQueryKeys.detail(chatId),
    exact: true,
  });
  for (const [queryKey, data] of queryClient.getQueriesData<
    InfiniteData<Array<ChatResponse>>
  >({ queryKey: chatQueryKeys.lists() })) {
    if (!chatListFiltersFromKey(queryKey) || !data) continue;
    queryClient.setQueryData<InfiniteData<Array<ChatResponse>>>(queryKey, {
      ...data,
      pages: data.pages.map((page) =>
        page.filter((item) => item.id !== chatId),
      ),
    });
  }
  updateSearchResults(queryClient, chatId, () => undefined);
  updatePinCards(queryClient, chatId, () => undefined);
}

function applyProject(
  queryClient: QueryClient,
  project: ProjectResponse,
): void {
  const pinnedIds = pinnedIdSet(queryClient);
  for (const [queryKey, data] of queryClient.getQueriesData<
    Array<ProjectResponse>
  >({
    queryKey: projectQueryKeys.lists(),
  })) {
    const filters = projectListFiltersFromKey(queryKey);
    if (!data || !filters) continue;
    const member = matchesListFilters(project, filters, pinnedIds);
    if (member === "unknown") {
      void queryClient.invalidateQueries({ queryKey, exact: true });
      continue;
    }
    queryClient.setQueryData(
      queryKey,
      placeRecord(data, project, member, filters.pinned !== "only"),
    );
  }
  updatePinCards(queryClient, project.id, (pin) =>
    pin.itemType === "project"
      ? {
          ...pin,
          item: {
            ...pin.item,
            name: project.name,
            archivedAt: project.archivedAt,
          },
        }
      : pin,
  );
}

function removeProject(queryClient: QueryClient, projectId: string): void {
  for (const [queryKey, data] of queryClient.getQueriesData<
    Array<ProjectResponse>
  >({
    queryKey: projectQueryKeys.lists(),
  })) {
    if (data) {
      queryClient.setQueryData(
        queryKey,
        data.filter((project) => project.id !== projectId),
      );
    }
  }
  updatePinCards(queryClient, projectId, () => undefined);
  // Chats filed into the project were moved by the server; refetch them.
  void queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
}

function applyPins(queryClient: QueryClient, items: Array<PinnedItem>): void {
  queryClient.setQueryData(pinQueryKeys.list(), items);
  // Pin-filtered lists change membership and order with the pin set.
  void queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      (chatListFiltersFromKey(queryKey) ?? projectListFiltersFromKey(queryKey))
        ?.pinned !== undefined,
  });
}

function updateSearchResults(
  queryClient: QueryClient,
  chatId: string,
  update: (result: ChatSearchResult) => ChatSearchResult | undefined,
): void {
  for (const [queryKey, data] of queryClient.getQueriesData<
    Array<ChatSearchResult>
  >({
    queryKey: chatQueryKeys.lists(),
  })) {
    if (queryKey[2] !== "search" || !data?.some((r) => r.id === chatId))
      continue;
    queryClient.setQueryData(
      queryKey,
      data.flatMap((result) => {
        if (result.id !== chatId) return [result];
        const next = update(result);
        return next ? [next] : [];
      }),
    );
  }
}

function updatePinCards(
  queryClient: QueryClient,
  itemId: string,
  update: (pin: PinnedItem) => PinnedItem | undefined,
): void {
  const pins = queryClient.getQueryData<Array<PinnedItem>>(pinQueryKeys.list());
  if (!pins?.some((pin) => pin.itemId === itemId)) return;
  queryClient.setQueryData(
    pinQueryKeys.list(),
    pins.flatMap((pin) => {
      if (pin.itemId !== itemId) return [pin];
      const next = update(pin);
      return next ? [next] : [];
    }),
  );
}
