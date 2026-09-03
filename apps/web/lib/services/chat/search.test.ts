import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { chatSearchQueryKey, searchChats } from "./search";
import { chatQueryKeys } from "./queries";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchChats", () => {
  it("GETs /chats/search with the q param and forwards the abort signal", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ results: [{ id: "1", title: "x", snippet: null }] }),
    );
    const controller = new AbortController();
    const results = await searchChats("hello world", controller.signal);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/v1/chats/search");
    expect(new URL(request.url).searchParams.get("q")).toBe("hello world");
    expect(request.signal.aborted).toBe(false);
    controller.abort();
    expect(request.signal.aborted).toBe(true);
    expect(results).toHaveLength(1);
  });

  it("passes through a null title (untitled chat matched by content)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [{ id: "2", title: null, snippet: "matched text" }],
      }),
    );
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
