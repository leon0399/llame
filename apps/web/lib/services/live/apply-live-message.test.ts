import { describe, expect, it, vi } from "vitest";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";

import type {
  ChatListItemResponse,
  ProjectResponse,
} from "../../api/live-generated/live-protocol";
import { activeRunsQueryKeys } from "../chat/active-runs";
import { chatQueryKeys, type ChatResponse } from "../chat/queries";
import type { ChatSearchResult } from "../chat/search";
import { pinQueryKeys } from "../pins/queries";
import type { PinnedItem } from "../pins/types";
import { projectQueryKeys } from "../project/queries";
import {
  applyLiveMessage,
  matchesListFilters,
  placeRecord,
} from "./apply-live-message";

const ID = {
  a: "11111111-1111-4111-8111-111111111111",
  b: "22222222-2222-4222-8222-222222222222",
  c: "33333333-3333-4333-8333-333333333333",
  project: "44444444-4444-4444-8444-444444444444",
};

function chat(
  id: string,
  updatedAt: string,
  overrides: Partial<ChatListItemResponse> = {},
): ChatListItemResponse {
  return {
    id,
    ownerUserId: "user-a",
    title: `Chat ${id.slice(0, 1)}`,
    visibility: "private",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt,
    archivedAt: null,
    projectId: null,
    workspaceRoot: null,
    lastMessage: "hi",
    ...overrides,
  };
}

function project(overrides: Partial<ProjectResponse> = {}): ProjectResponse {
  return {
    id: ID.project,
    ownerUserId: "user-a",
    name: "Project",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

const pages = (...items: Array<ChatResponse>) => ({
  pages: [items],
  pageParams: [undefined],
});

function ids(client: QueryClient, key: ReadonlyArray<unknown>) {
  return client
    .getQueryData<InfiniteData<Array<ChatResponse>>>(key)
    ?.pages.flat()
    .map((item) => item.id);
}

const pin = (itemId: string, title: string): PinnedItem => ({
  itemType: "chat",
  itemId,
  pinnedAt: "2026-10-01T00:00:00.000Z",
  item: { id: itemId, title, archivedAt: null },
});

describe("matchesListFilters", () => {
  const active = { id: ID.a, archivedAt: null };
  const archived = { id: ID.a, archivedAt: "2026-10-03T00:00:00.000Z" };

  it("applies the archive filter", () => {
    expect(matchesListFilters(active, {}, undefined)).toBe(true);
    expect(matchesListFilters(archived, {}, undefined)).toBe(false);
    expect(matchesListFilters(archived, { archived: "only" }, undefined)).toBe(
      true,
    );
    expect(matchesListFilters(active, { archived: "only" }, undefined)).toBe(
      false,
    );
    expect(matchesListFilters(archived, { archived: "with" }, undefined)).toBe(
      true,
    );
  });

  it("applies the pin filter, or reports unknown without pin state", () => {
    const pinned = new Set([ID.a]);
    expect(matchesListFilters(active, { pinned: "only" }, pinned)).toBe(true);
    expect(matchesListFilters(active, { pinned: "exclude" }, pinned)).toBe(
      false,
    );
    expect(matchesListFilters(active, { pinned: "exclude" }, new Set())).toBe(
      true,
    );
    expect(matchesListFilters(active, { pinned: "with" }, undefined)).toBe(
      true,
    );
    expect(matchesListFilters(active, { pinned: "only" }, undefined)).toBe(
      "unknown",
    );
  });
});

describe("placeRecord", () => {
  const older = chat(ID.b, "2026-10-02T00:00:00.000Z");
  const oldest = chat(ID.c, "2026-10-01T00:00:00.000Z");

  it("inserts or moves a record into updatedAt order", () => {
    const fresh = chat(ID.a, "2026-10-05T00:00:00.000Z");
    expect(placeRecord([older, oldest], fresh, true, true)).toEqual([
      fresh,
      older,
      oldest,
    ]);
    const middle = chat(ID.a, "2026-10-01T12:00:00.000Z");
    expect(placeRecord([older, oldest], middle, true, true)).toEqual([
      older,
      middle,
      oldest,
    ]);
    const last = chat(ID.a, "2026-09-01T00:00:00.000Z");
    expect(placeRecord([older, oldest], last, true, true)).toEqual([
      older,
      oldest,
      last,
    ]);
  });

  it("replaces in place when unsorted, prepends when new, and removes non-members", () => {
    const renamed = { ...older, title: "Renamed" };
    expect(placeRecord([oldest, older], renamed, true, false)).toEqual([
      oldest,
      renamed,
    ]);
    const fresh = chat(ID.a, "2026-09-01T00:00:00.000Z");
    expect(placeRecord([oldest], fresh, true, false)).toEqual([fresh, oldest]);
    expect(placeRecord([oldest, older], older, false, true)).toEqual([oldest]);
  });
});

describe("applyLiveMessage", () => {
  function seeded() {
    const client = new QueryClient();
    client.setQueryData(
      chatQueryKeys.infinite(),
      pages(
        chat(ID.b, "2026-10-02T00:00:00.000Z"),
        chat(ID.a, "2026-10-01T00:00:00.000Z"),
      ),
    );
    client.setQueryData(chatQueryKeys.infinite({ archived: "only" }), pages());
    client.setQueryData(
      chatQueryKeys.infinite({ projectId: ID.project }),
      pages(),
    );
    return client;
  }

  it("updates a chat in place, re-sorts, and refreshes detail, search, and pin cards", () => {
    const client = seeded();
    client.setQueryData(pinQueryKeys.list(), [pin(ID.a, "Chat 1")]);
    client.setQueryData<Array<ChatSearchResult>>(
      chatQueryKeys.search({ q: "chat" }),
      [
        {
          id: ID.a,
          title: "Chat 1",
          snippet: null,
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    );
    const updated = chat(ID.a, "2026-10-05T00:00:00.000Z", {
      title: "Renamed",
    });

    applyLiveMessage(client, { type: "chat.upserted", chat: updated });

    expect(ids(client, chatQueryKeys.infinite())).toEqual([ID.a, ID.b]);
    expect(
      client.getQueryData<InfiniteData<Array<ChatResponse>>>(
        chatQueryKeys.infinite(),
      )?.pages[0]?.[0]?.title,
    ).toBe("Renamed");
    const { lastMessage: _omit, ...detail } = updated;
    expect(client.getQueryData(chatQueryKeys.detail(ID.a))).toEqual(detail);
    expect(
      client.getQueryData<Array<ChatSearchResult>>(
        chatQueryKeys.search({ q: "chat" }),
      )?.[0]?.title,
    ).toBe("Renamed");
    expect(
      client.getQueryData<Array<PinnedItem>>(pinQueryKeys.list())?.[0]?.item,
    ).toMatchObject({ title: "Renamed" });
    expect(ids(client, chatQueryKeys.infinite({ archived: "only" }))).toEqual(
      [],
    );
  });

  it("inserts a new chat only into the lists whose filters it matches", () => {
    const client = seeded();
    const fresh = chat(ID.c, "2026-10-06T00:00:00.000Z", {
      projectId: ID.project,
    });

    applyLiveMessage(client, { type: "chat.upserted", chat: fresh });

    expect(ids(client, chatQueryKeys.infinite())).toEqual([ID.c, ID.b, ID.a]);
    expect(
      ids(client, chatQueryKeys.infinite({ projectId: ID.project })),
    ).toEqual([ID.c]);
    expect(ids(client, chatQueryKeys.infinite({ archived: "only" }))).toEqual(
      [],
    );
  });

  it("moves an archived chat out of the default list and into the archive", () => {
    const client = seeded();
    applyLiveMessage(client, {
      type: "chat.upserted",
      chat: chat(ID.a, "2026-10-01T00:00:00.000Z", {
        archivedAt: "2026-10-07T00:00:00.000Z",
      }),
    });

    expect(ids(client, chatQueryKeys.infinite())).toEqual([ID.b]);
    expect(ids(client, chatQueryKeys.infinite({ archived: "only" }))).toEqual([
      ID.a,
    ]);
  });

  it("refetches a pin-filtered list it cannot place without pin state", () => {
    const client = seeded();
    const pinnedKey = chatQueryKeys.infinite({ pinned: "only" });
    client.setQueryData(pinnedKey, pages());
    const invalidate = vi.spyOn(client, "invalidateQueries");

    applyLiveMessage(client, {
      type: "chat.upserted",
      chat: chat(ID.c, "2026-10-06T00:00:00.000Z"),
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: pinnedKey,
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("places a chat in pin-filtered lists from the cached pin state, keeping pin order", () => {
    const client = seeded();
    client.setQueryData(pinQueryKeys.list(), [pin(ID.a, "Chat 1")]);
    const pinnedKey = chatQueryKeys.infinite({ pinned: "only" });
    const unpinnedKey = chatQueryKeys.infinite({ pinned: "exclude" });
    client.setQueryData(
      pinnedKey,
      pages(chat(ID.a, "2026-10-01T00:00:00.000Z")),
    );
    client.setQueryData(
      unpinnedKey,
      pages(chat(ID.b, "2026-10-02T00:00:00.000Z")),
    );

    applyLiveMessage(client, {
      type: "chat.upserted",
      chat: chat(ID.a, "2026-10-09T00:00:00.000Z", { title: "Pinned" }),
    });

    expect(ids(client, pinnedKey)).toEqual([ID.a]);
    expect(ids(client, unpinnedKey)).toEqual([ID.b]);
  });

  it("removes a deleted chat from every cache", () => {
    const client = seeded();
    client.setQueryData(chatQueryKeys.detail(ID.a), { id: ID.a });
    client.setQueryData(pinQueryKeys.list(), [
      pin(ID.a, "Chat 1"),
      pin(ID.b, "Chat 2"),
    ]);
    client.setQueryData<Array<ChatSearchResult>>(
      chatQueryKeys.search({ q: "chat" }),
      [{ id: ID.a, title: "x", snippet: null, updatedAt: "2026-10-01" }],
    );

    applyLiveMessage(client, { type: "chat.deleted", chatId: ID.a });

    expect(ids(client, chatQueryKeys.infinite())).toEqual([ID.b]);
    expect(client.getQueryData(chatQueryKeys.detail(ID.a))).toBeUndefined();
    expect(
      client
        .getQueryData<Array<PinnedItem>>(pinQueryKeys.list())
        ?.map((p) => p.itemId),
    ).toEqual([ID.b]);
    expect(client.getQueryData(chatQueryKeys.search({ q: "chat" }))).toEqual(
      [],
    );
  });

  it("updates, archives, and deletes projects in their lists", () => {
    const client = new QueryClient();
    client.setQueryData(projectQueryKeys.filtered(), [project()]);
    client.setQueryData(projectQueryKeys.filtered({ archived: "only" }), []);
    client.setQueryData(pinQueryKeys.list(), [
      {
        itemType: "project",
        itemId: ID.project,
        pinnedAt: "2026-10-01T00:00:00.000Z",
        item: { id: ID.project, name: "Project", archivedAt: null },
      },
    ]);
    const invalidate = vi.spyOn(client, "invalidateQueries");

    applyLiveMessage(client, {
      type: "project.upserted",
      project: project({ name: "Renamed" }),
    });
    expect(
      client.getQueryData<Array<ProjectResponse>>(
        projectQueryKeys.filtered(),
      )?.[0]?.name,
    ).toBe("Renamed");
    expect(
      client.getQueryData<Array<PinnedItem>>(pinQueryKeys.list())?.[0]?.item,
    ).toMatchObject({ name: "Renamed" });

    applyLiveMessage(client, {
      type: "project.upserted",
      project: project({ archivedAt: "2026-10-08T00:00:00.000Z" }),
    });
    expect(client.getQueryData(projectQueryKeys.filtered())).toEqual([]);
    expect(
      client.getQueryData<Array<ProjectResponse>>(
        projectQueryKeys.filtered({ archived: "only" }),
      ),
    ).toHaveLength(1);

    applyLiveMessage(client, {
      type: "project.deleted",
      projectId: ID.project,
    });
    expect(
      client.getQueryData(projectQueryKeys.filtered({ archived: "only" })),
    ).toEqual([]);
    expect(client.getQueryData(pinQueryKeys.list())).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatQueryKeys.lists(),
    });
  });

  it("replaces the pin list and refetches only pin-filtered lists", () => {
    const client = seeded();
    const pinnedKey = chatQueryKeys.infinite({ pinned: "only" });
    client.setQueryData(pinnedKey, pages());
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const items = [pin(ID.b, "Chat 2")];

    applyLiveMessage(client, { type: "pins.replaced", items });

    expect(client.getQueryData(pinQueryKeys.list())).toEqual(items);
    const refetched = invalidate.mock.calls.flatMap(([filters]) =>
      client
        .getQueryCache()
        .findAll(filters)
        .map((query) => JSON.stringify(query.queryKey)),
    );
    expect(refetched).toEqual([JSON.stringify(pinnedKey)]);
  });

  it("refetches every owner list on resync and ignores run messages", () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    applyLiveMessage(client, {
      type: "run.progress",
      runId: ID.a,
      chatId: ID.b,
      phase: "tool",
      step: 1,
    });
    expect(invalidate).not.toHaveBeenCalled();

    applyLiveMessage(client, { type: "resync" });
    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      chatQueryKeys.all,
      pinQueryKeys.list(),
      projectQueryKeys.lists(),
      activeRunsQueryKeys.all,
    ]);
  });
});
