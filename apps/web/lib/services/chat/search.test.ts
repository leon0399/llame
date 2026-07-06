import { afterEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../api/client", () => ({
  api: { get: (...a: unknown[]) => ({ json: () => get(...a) }) },
  buildApiUrl: (path: string) => `http://api${path}`,
}));

import { chatSearchQueryKey, searchChats } from "./search";
import { chatQueryKeys } from "./queries";

afterEach(() => get.mockReset());

describe("searchChats", () => {
  it("GETs /chats/search with the q param and forwards the abort signal", async () => {
    get.mockResolvedValue({
      results: [{ id: "1", title: "x", snippet: null }],
    });
    const signal = new AbortController().signal;
    const results = await searchChats("hello world", signal);

    const [url, opts] = get.mock.calls[0] as [string, { signal?: AbortSignal }];
    expect(url).toContain("http://api/api/v1/chats/search");
    // q is URL-encoded in the query string.
    expect(url).toContain("q=hello+world");
    expect(opts.signal).toBe(signal);
    expect(results).toHaveLength(1);
  });

  it("passes through a null title (untitled chat matched by content)", async () => {
    get.mockResolvedValue({
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
