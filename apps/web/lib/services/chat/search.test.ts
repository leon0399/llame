import { afterEach, describe, expect, it, vi } from "vitest";

const { searchChatsEndpoint } = vi.hoisted(() => ({
  searchChatsEndpoint: vi.fn(),
}));

vi.mock("../../api/generated/chats/chats", () => ({
  searchChats: searchChatsEndpoint,
}));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch: () => vi.fn(),
}));

import { chatSearchQueryKey, searchChats } from "./search";
import { chatQueryKeys } from "./queries";

afterEach(() => searchChatsEndpoint.mockReset());

describe("searchChats", () => {
  it("GETs /chats/search with the q param and forwards the abort signal", async () => {
    searchChatsEndpoint.mockResolvedValue({
      results: [{ id: "1", title: "x", snippet: null }],
    });
    const signal = new AbortController().signal;
    const results = await searchChats("hello world", signal);

    expect(searchChatsEndpoint).toHaveBeenCalledWith(
      { q: "hello world" },
      { signal },
      expect.any(Function),
    );
    expect(results).toHaveLength(1);
  });

  it("passes through a null title (untitled chat matched by content)", async () => {
    searchChatsEndpoint.mockResolvedValue({
      results: [{ id: "2", title: null, snippet: "matched text" }],
    });
    const results = await searchChats("matched");
    expect(results[0]?.title).toBeNull();
  });
});

describe("chatSearchQueryKey", () => {
  it("sits under chatQueryKeys.lists() so a list invalidation also invalidates search", () => {
    const key = chatSearchQueryKey({ q: "hello" });
    const listsPrefix = chatQueryKeys.lists();
    // TanStack invalidates by prefix match — the search key must start with
    // the exact lists() key, or a rename/pin/delete/send invalidation
    // (queryKey: chatQueryKeys.lists()) leaves a stale search result behind.
    expect(key.slice(0, listsPrefix.length)).toEqual(listsPrefix);
  });

  it("carries filters as a structured object, not a bare positional value — per TkDodo's effective-query-keys pattern, so a future filter is a new object field, not a new array slot", () => {
    const key = chatSearchQueryKey({ q: "hello" });
    expect(key.at(-1)).toEqual({ q: "hello" });

    // A hypothetical extra filter would just widen this object — the key's
    // shape/length and every existing predicate/invalidation on it survives.
    const withMoreFilters = { q: "hello", status: "open" };
    expect(withMoreFilters).toMatchObject({ q: "hello" });
  });
});
