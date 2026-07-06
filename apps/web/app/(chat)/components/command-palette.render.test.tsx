// @vitest-environment jsdom

/**
 * Render-level proof for the command palette's design-matching visual pass
 * (see command-palette.tsx's doc comment): recent chats visible on open with
 * no input, the Esc hint next to the input, Actions staying mounted/
 * searchable even once content-search kicks in (typing "settings" must
 * still find and run the Settings action — actions are NOT stripped out
 * past MIN_SEARCH_LENGTH, only cmdk's own fuzzy filter governs their
 * visibility), and the content-search "Chats" group rendering title +
 * snippet + a trailing "Chat" kind badge and navigating + closing on
 * select. Mirrors chat-item.test.tsx's Radix render-test harness. The
 * existing command-palette.test.ts only covers the pure `isPaletteToggle`
 * matcher — this covers the dialog wiring.
 */

import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const routerPushMock = vi.fn();
const useChatSearchQueryMock = vi.fn();
const useChatsQueryMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock("@/lib/hooks/use-debounced-value", () => ({
  // No real timers in this test — drive the query hook straight off input.
  useDebouncedValue: (value: string) => value,
}));

vi.mock("@/lib/services/chat/search", () => ({
  MIN_SEARCH_LENGTH: 2,
  useChatSearchQuery: (q: string) => useChatSearchQueryMock(q),
}));

vi.mock("@/lib/services/chat/queries", () => ({
  useChatsQuery: () => useChatsQueryMock(),
}));

vi.mock("@/contexts/chat-context", () => ({
  useChatContext: () => ({
    setActiveChatId: vi.fn(),
    setDraftChatId: vi.fn(),
  }),
}));

import { CommandPaletteProvider, useCommandPalette } from "./command-palette";

beforeAll(() => {
  // jsdom doesn't implement the Pointer Events capture API Radix's Dialog
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
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
      ResizeObserverStub;
  }
});

afterEach(() => {
  routerPushMock.mockReset();
  useChatSearchQueryMock.mockReset();
  useChatsQueryMock.mockReset();
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
  return render(
    <CommandPaletteProvider>
      <Trigger />
    </CommandPaletteProvider>,
  );
}

describe("CommandPaletteProvider — design-matching visual pass", () => {
  it("shows Actions and an Esc hint while idle", async () => {
    useChatSearchQueryMock.mockReturnValue({
      data: undefined,
      isFetching: false,
    });
    useChatsQueryMock.mockReturnValue({ data: { pages: [[]] } });
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("New chat")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Esc")).toBeTruthy();
  });

  it("shows recent chats on open with no input typed, with the same lastMessage excerpt as the chat list", async () => {
    useChatSearchQueryMock.mockReturnValue({
      data: undefined,
      isFetching: false,
    });
    useChatsQueryMock.mockReturnValue({
      data: {
        pages: [
          [
            {
              id: "chat-1",
              title: "Recent chat",
              lastMessage: "how's it going",
              pinnedAt: null,
            },
          ],
        ],
      },
    });
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(screen.getByText("Recent chat")).toBeTruthy();
    expect(screen.getByText("how's it going")).toBeTruthy();
  });

  it("keeps Actions searchable past MIN_SEARCH_LENGTH — typing 'sett' still finds and runs Settings", async () => {
    // Content search runs in parallel once searching; keep it empty so the
    // assertion is purely about Actions surviving cmdk's own fuzzy filter.
    useChatSearchQueryMock.mockReturnValue({ data: [], isFetching: false });
    useChatsQueryMock.mockReturnValue({ data: { pages: [[]] } });
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(
      screen.getByPlaceholderText("Search chats, projects, memories…"),
      "sett",
    );

    await user.click(await screen.findByText("Settings"));

    expect(routerPushMock).toHaveBeenCalledWith("/settings");
  });

  it("renders grouped chat results with a Chat kind badge and navigates + closes on select", async () => {
    useChatSearchQueryMock.mockReturnValue({
      data: [
        { id: "chat-1", title: "My chat", snippet: "hello world", updatedAt: "" },
      ],
      isFetching: false,
    });
    useChatsQueryMock.mockReturnValue({ data: { pages: [[]] } });
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

    expect(routerPushMock).toHaveBeenCalledWith("/chat/chat-1");
    expect(
      screen.queryByPlaceholderText("Search chats, projects, memories…"),
    ).toBeNull();
  });
});
