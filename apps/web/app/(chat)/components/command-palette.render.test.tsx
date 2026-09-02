// @vitest-environment jsdom

/**
 * Render-level proof for the command palette's design-matching visual pass
 * (see command-palette.tsx's doc comment): recent chats visible on open with
 * no input, the Esc hint next to the input, Actions staying mounted/
 * searchable even once content-search kicks in (typing "settings" must
 * still find and run the Settings action — actions are NOT stripped out
 * past MIN_SEARCH_LENGTH, only cmdk's own fuzzy filter governs their
 * visibility), the content-search "Chats" group rendering title + snippet +
 * a trailing "Chat" kind badge and navigating + closing on select (with the
 * dialog closing immediately but the actual navigation deferred past the
 * close animation — see command-palette.tsx's `run` comment for why: firing
 * router.push() in the same tick as the close previously flickered the
 * palette back into view for a moment), the query surviving a close-via-
 * selection so reopening resumes the same search, and the clear button
 * appearing/clearing once there's a query. Mirrors chat-item.test.tsx's
 * render-test harness. The existing command-palette.test.ts only
 * covers the pure `isPaletteToggle` matcher — this covers the dialog wiring.
 *
 * useChatsQuery/useChatSearchQuery and useDebouncedValue run for real here —
 * GET /api/v1/chats and GET /api/v1/chats/search hit a stubbed
 * globalThis.fetch, routed by pathname, and the search assertions wait out
 * the real 300ms debounce via findByText rather than assuming a synchronous
 * query. Only next/navigation (no in-process seam) is mocked.
 */

import * as React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Mock } from "vitest";

import type {
  ChatListItemResponse,
  ChatSearchResultResponse,
} from "@/lib/api/generated/models";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

const routerPushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

import { CommandPaletteProvider, useCommandPalette } from "./command-palette";

function chatListItemFixture(
  overrides: Pick<ChatListItemResponse, "id" | "title"> &
    Partial<ChatListItemResponse>,
): ChatListItemResponse {
  return {
    ownerUserId: "user-1",
    visibility: "private",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    projectId: null,
    lastMessage: null,
    ...overrides,
  };
}

let fetchMock: Mock<typeof fetch>;
// Per-test-overridable handlers for the two endpoints the palette queries.
let chatsHandler: () => Promise<Response>;
let searchHandler: (q: string) => Promise<Response>;

function stubPaletteNetwork() {
  fetchMock = stubFetch();
  chatsHandler = () =>
    Promise.resolve(jsonResponse<Array<ChatListItemResponse>>([]));
  searchHandler = () =>
    Promise.resolve(
      jsonResponse<{ results: Array<ChatSearchResultResponse> }>({
        results: [],
      }),
    );
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname, searchParams } = new URL(request.url);
    if (pathname === "/api/v1/chats/search") {
      return searchHandler(searchParams.get("q") ?? "");
    }
    if (pathname === "/api/v1/chats") return chatsHandler();
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
}

beforeAll(() => {
  // jsdom doesn't implement the Pointer Events capture API Base UI's Dialog
  // (and cmdk's Command) rely on for open/close + focus handling.
  for (const method of [
    "hasPointerCapture",
    "setPointerCapture",
    "releasePointerCapture",
  ] as const) {
    if (!(method in Element.prototype)) {
      Object.defineProperty(Element.prototype, method, {
        value: () => false,
        writable: true,
      });
    }
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  // jsdom doesn't implement ResizeObserver, which cmdk's Command uses to
  // measure and animate its list height.
  if (!("ResizeObserver" in globalThis)) {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverStub {
        constructor(_callback: ResizeObserverCallback) {}
        observe(_target: Element, _options?: ResizeObserverOptions): void {}
        unobserve(_target: Element): void {}
        disconnect(): void {}
      },
    );
  }
});

beforeEach(() => {
  stubPaletteNetwork();
});

afterEach(() => {
  routerPushMock.mockReset();
  // NOT vi.unstubAllGlobals() — beforeAll's ResizeObserver/pointer-capture
  // stubs must survive across tests; beforeEach's stubFetch() already
  // replaces fetch fresh each test.
  cleanup();
});

function Trigger() {
  const palette = useCommandPalette();
  return (
    <button type="button" onClick={() => palette.open()}>
      Search
    </button>
  );
}

function renderPalette() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandPaletteProvider>
        <Trigger />
      </CommandPaletteProvider>
    </QueryClientProvider>,
  );
}

// `run()` closes the dialog immediately but defers the actual action
// (router.push, etc.) past the dialog's close animation — see
// command-palette.tsx's comment on `run`. Real timers are in use (userEvent
// needs them), so tests that select an item must wait this out: both to
// assert the deferred effect, and so the pending timer can't fire mid the
// NEXT test and pollute its mocks.
async function waitForDeferredAction() {
  await new Promise((resolve) => setTimeout(resolve, 250));
}

describe("useCommandPalette", () => {
  it("throws when called outside a CommandPaletteProvider", () => {
    // React logs its own error-boundary console.error for this — silence it,
    // it's the assertion, not a leak.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    expect(() => render(<Trigger />)).toThrow(
      "useCommandPalette must be used within CommandPaletteProvider",
    );
    consoleError.mockRestore();
  });
});

describe("CommandPaletteProvider — ⌘K / Ctrl+K shortcut", () => {
  it("opens the palette on Ctrl+K and does not react to a held-repeat", async () => {
    renderPalette();
    expect(
      screen.queryByPlaceholderText("Search chats, projects, memories…"),
    ).toBeNull();

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(
      await screen.findByPlaceholderText("Search chats, projects, memories…"),
    ).toBeTruthy();
  });

  it("ignores a repeat keydown (a held chord) so it does not flicker the toggle", () => {
    renderPalette();

    fireEvent.keyDown(document, { key: "k", ctrlKey: true, repeat: true });

    expect(
      screen.queryByPlaceholderText("Search chats, projects, memories…"),
    ).toBeNull();
  });
});

describe("CommandPaletteProvider — design-matching visual pass", () => {
  it("shows Actions and an Esc hint while idle", async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("New chat")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Esc")).toBeTruthy();
  });

  it("shows recent chats on open with no input typed, with the same lastMessage excerpt as the chat list", async () => {
    chatsHandler = () =>
      Promise.resolve(
        jsonResponse<Array<ChatListItemResponse>>([
          chatListItemFixture({
            id: "chat-1",
            title: "Recent chat",
            lastMessage: "how's it going",
          }),
        ]),
      );
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Recent chat")).toBeTruthy();
    expect(screen.getByText("how's it going")).toBeTruthy();
  });

  it("keeps Actions searchable past MIN_SEARCH_LENGTH — typing 'sett' still finds and runs Settings", async () => {
    // Content search runs in parallel once searching (default empty
    // searchHandler) so the assertion is purely about Actions surviving
    // cmdk's own fuzzy filter.
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(
      screen.getByPlaceholderText("Search chats, projects, memories…"),
      "sett",
    );

    await user.click(await screen.findByText("Settings"));
    await waitForDeferredAction();

    expect(routerPushMock).toHaveBeenCalledWith("/settings");
  });

  it("renders grouped chat results with a Chat kind badge and navigates + closes on select", async () => {
    searchHandler = () =>
      Promise.resolve(
        jsonResponse<{ results: Array<ChatSearchResultResponse> }>({
          results: [
            {
              id: "chat-1",
              title: "My chat",
              snippet: "hello world",
              updatedAt: "",
            },
          ],
        }),
      );
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(
      screen.getByPlaceholderText("Search chats, projects, memories…"),
      "hello",
    );

    expect(await screen.findByText("My chat")).toBeTruthy();
    expect(screen.getByText("hello world")).toBeTruthy();
    expect(screen.getByText("Chat")).toBeTruthy();

    await user.click(screen.getByText("My chat"));

    // The dialog closes immediately...
    expect(
      screen.queryByPlaceholderText("Search chats, projects, memories…"),
    ).toBeNull();
    // ...but navigation is deferred past the close animation (see run()) —
    // it must NOT have fired yet in this same tick.
    expect(routerPushMock).not.toHaveBeenCalled();

    await waitForDeferredAction();

    expect(routerPushMock).toHaveBeenCalledWith("/chat/chat-1");
  });

  it("keeps the query and results after closing via a selection, so reopening lands on the same search", async () => {
    searchHandler = () =>
      Promise.resolve(
        jsonResponse<{ results: Array<ChatSearchResultResponse> }>({
          results: [
            {
              id: "chat-1",
              title: "My chat",
              snippet: "hello world",
              updatedAt: "",
            },
          ],
        }),
      );
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(
      screen.getByPlaceholderText("Search chats, projects, memories…"),
      "hello",
    );
    await user.click(await screen.findByText("My chat"));
    await waitForDeferredAction();

    // Closed by selecting a result (not what they wanted) — reopening should
    // land right back on the same query/results to try the next one.
    await user.click(screen.getByRole("button", { name: "Search" }));

    // SAFETY: this placeholder is only ever rendered on the palette's
    // search `<input>`, so the query result is always an `HTMLInputElement`
    // — `getByPlaceholderText` itself only types its result as `HTMLElement`.
    expect(
      (
        screen.getByPlaceholderText(
          "Search chats, projects, memories…",
        ) as HTMLInputElement
      ).value,
    ).toBe("hello");
    expect(screen.getByText("My chat")).toBeTruthy();
  });

  it("New Chat action navigates home", async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(screen.getByText("New chat"));
    await waitForDeferredAction();

    expect(routerPushMock).toHaveBeenCalledWith("/");
  });

  it("selecting a recent chat navigates to it", async () => {
    chatsHandler = () =>
      Promise.resolve(
        jsonResponse<Array<ChatListItemResponse>>([
          chatListItemFixture({ id: "chat-1", title: "Recent chat" }),
        ]),
      );
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByText("Recent chat"));
    await waitForDeferredAction();

    expect(routerPushMock).toHaveBeenCalledWith("/chat/chat-1");
  });

  it("shows a clear button once there's a query, and clears it on click", async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

    // SAFETY: this placeholder is only ever rendered on the palette's
    // search `<input>`, so the query result is always an `HTMLInputElement`
    // — `getByPlaceholderText` itself only types its result as `HTMLElement`.
    const input = screen.getByPlaceholderText(
      "Search chats, projects, memories…",
    ) as HTMLInputElement;
    await user.type(input, "hello");

    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(input.value).toBe("");
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });
});

/**
 * #171: cmdk re-filtered/re-ranked server search results client-side using
 * its own fuzzy match over each item's `value` — but that `value` is only
 * `title + snippet`, not the full message content the api actually searched.
 * A result matched purely on message CONTENT (the term isn't in the title or
 * the truncated snippet shown in the UI) scores an exact 0 in cmdk's default
 * filter and gets hidden outright — that's the real "search returns nothing"
 * bug (verified against cmdk's `defaultFilter` directly: it returns exactly
 * 0 for a content-only match, case notwithstanding). Fixed by passing server
 * results through cmdk's filter untouched (passThroughServerResultsFilter in
 * command-palette.tsx) while leaving Actions/recent-chats on cmdk's normal
 * fuzzy filter. See also the "renders grouped chat results" test above,
 * which already covers a title+snippet-visible match end-to-end.
 */
describe("CommandPaletteProvider — #171 server-result filtering", () => {
  it("surfaces a content-only match (query absent from title/snippet — cmdk's own filter would score this 0 and hide it)", async () => {
    searchHandler = () =>
      Promise.resolve(
        jsonResponse<{ results: Array<ChatSearchResultResponse> }>({
          results: [
            {
              id: "chat-1",
              title: "Meeting Notes",
              snippet: "budget discussion",
              updatedAt: "",
            },
          ],
        }),
      );
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));
    // "quarterly" appears in neither the title nor the snippet — only in
    // message content the api matched but the client never sees verbatim.
    await user.type(
      screen.getByPlaceholderText("Search chats, projects, memories…"),
      "quarterly",
    );

    expect(await screen.findByText("Meeting Notes")).toBeTruthy();
  });

  it("surfaces a content-only match with a Cyrillic query (case- and script-insensitive end-to-end)", async () => {
    searchHandler = () =>
      Promise.resolve(
        jsonResponse<{ results: Array<ChatSearchResultResponse> }>({
          results: [
            {
              id: "chat-1",
              title: "Заметки о встрече",
              snippet: "обсуждение бюджета",
              updatedAt: "",
            },
          ],
        }),
      );
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));
    // Lowercased Cyrillic term matched in message content only.
    await user.type(
      screen.getByPlaceholderText("Search chats, projects, memories…"),
      "квартальный",
    );

    expect(await screen.findByText("Заметки о встрече")).toBeTruthy();
  });

  it("surfaces an exact chat title typed in all-lowercase via the server-results path", async () => {
    searchHandler = () =>
      Promise.resolve(
        jsonResponse<{ results: Array<ChatSearchResultResponse> }>({
          results: [
            {
              id: "chat-1",
              title: "Redis Migration Notes",
              snippet: null,
              updatedAt: "",
            },
          ],
        }),
      );
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(
      screen.getByPlaceholderText("Search chats, projects, memories…"),
      "redis migration notes",
    );

    expect(await screen.findByText("Redis Migration Notes")).toBeTruthy();
  });

  it("surfaces a Cyrillic chat title typed in all-lowercase via the server-results path", async () => {
    searchHandler = () =>
      Promise.resolve(
        jsonResponse<{ results: Array<ChatSearchResultResponse> }>({
          results: [
            {
              id: "chat-1",
              title: "Тестовый Чат",
              snippet: null,
              updatedAt: "",
            },
          ],
        }),
      );
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(
      screen.getByPlaceholderText("Search chats, projects, memories…"),
      "тестовый чат",
    );

    expect(await screen.findByText("Тестовый Чат")).toBeTruthy();
  });

  it("preserves the server's result order instead of re-ranking by cmdk's fuzzy score", async () => {
    // "Ab Testing Plan" scores marginally HIGHER than "Database AB Migration"
    // under cmdk's own fuzzy filter for the query "ab" (prefix match vs. a
    // buried, non-adjacent match — verified directly against cmdk's
    // `defaultFilter`). The server intentionally returns them in the
    // OPPOSITE order; a re-ranking client would flip them back.
    searchHandler = () =>
      Promise.resolve(
        jsonResponse<{ results: Array<ChatSearchResultResponse> }>({
          results: [
            {
              id: "chat-b",
              title: "Database AB Migration",
              snippet: null,
              updatedAt: "",
            },
            {
              id: "chat-a",
              title: "Ab Testing Plan",
              snippet: null,
              updatedAt: "",
            },
          ],
        }),
      );
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(
      screen.getByPlaceholderText("Search chats, projects, memories…"),
      "ab",
    );

    await screen.findByText("Database AB Migration");
    // CommandDialog renders through a Base UI portal into document.body, not
    // into RTL's `container` — query the document directly instead.
    const titles = Array.from(
      document.body.querySelectorAll("[cmdk-item] span.truncate"),
    ).map((el) => el.textContent);

    expect(titles).toEqual(["Database AB Migration", "Ab Testing Plan"]);
  });

  it("still hides an unrelated recent chat while keeping Actions and a matching recent chat (below MIN_SEARCH_LENGTH, cmdk's own filter still applies)", async () => {
    chatsHandler = () =>
      Promise.resolve(
        jsonResponse<Array<ChatListItemResponse>>([
          chatListItemFixture({ id: "chat-1", title: "Recent Match" }),
          chatListItemFixture({ id: "chat-2", title: "Totally Different" }),
        ]),
      );
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));
    // A 1-char query stays below MIN_SEARCH_LENGTH — the client-only
    // recent-chats path (cmdk's own fuzzy filter, unaffected by the #171
    // fix). "m" appears in "Match" but nowhere in "Totally Different".
    await user.type(
      screen.getByPlaceholderText("Search chats, projects, memories…"),
      "m",
    );

    expect(await screen.findByText("Recent Match")).toBeTruthy();
    expect(screen.queryByText("Totally Different")).toBeNull();
  });
});
