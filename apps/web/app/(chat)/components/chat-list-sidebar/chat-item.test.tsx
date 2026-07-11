// @vitest-environment jsdom

/**
 * Render-level proof for the sidebar's "Fork" (clone-whole-chat) menu item:
 * it renders, and selecting it fires the fork mutation with NO anchor
 * (fromMessageId omitted), then navigates to the new chat — mirroring
 * message-fork-button.test.tsx's coverage of the per-message fork action.
 */

import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarMenu, SidebarProvider } from "@workspace/ui/components/sidebar";

const mutateMock = vi.fn();
const routerPushMock = vi.fn();

vi.mock("@/lib/services/chat/fork", () => ({
  useForkChat: () => ({ mutate: mutateMock, isPending: false }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: routerPushMock }),
}));
// ChatItem reads completedChats/activeChatIds (the activity indicator) from
// this context; isolate the test from ActiveRunsProvider's real
// polling/fetch effects, matching this file's existing hook-mocking
// convention. Mutable so individual tests can vary which chats are
// unread/processing.
let mockCompletedChats = new Set<string>();
let mockActiveChatIds = new Set<string>();
vi.mock("@/contexts/active-runs-context", () => ({
  useActiveRuns: () => ({
    completedChats: mockCompletedChats,
    activeChatIds: mockActiveChatIds,
  }),
}));

import { ChatItem } from "./chat-item";

beforeAll(() => {
  // jsdom doesn't implement matchMedia — @workspace/ui's SidebarProvider
  // uses it (useIsMobile) to decide desktop vs. mobile chrome.
  window.matchMedia =
    window.matchMedia ??
    ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));

  // jsdom doesn't implement the Pointer Events capture API Radix's
  // DropdownMenu relies on for its open/close + focus handling.
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
});

function renderChatItem() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <SidebarMenu>
          <ChatItem
            chat={{
              id: "chat-1",
              title: "My chat",
              lastMessage: null,
              visibility: "private",
              pinnedAt: null,
              projectId: null,
            }}
            onSelect={vi.fn()}
          />
        </SidebarMenu>
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  mutateMock.mockReset();
  routerPushMock.mockReset();
  mockCompletedChats = new Set();
  mockActiveChatIds = new Set();
  cleanup();
});

describe("ChatItem row menu — Fork (clone whole chat)", () => {
  it("opens the row menu and renders a Fork item", async () => {
    const user = userEvent.setup();
    renderChatItem();

    await user.click(screen.getByRole("button", { name: /more/i }));

    expect(await screen.findByRole("menuitem", { name: "Fork" })).toBeTruthy();
  });

  it("fires the fork mutation with NO fromMessageId and navigates on success", async () => {
    const user = userEvent.setup();
    renderChatItem();

    await user.click(screen.getByRole("button", { name: /more/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Fork" }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const [args, opts] = mutateMock.mock.calls[0] as [
      { chatId: string; fromMessageId?: string },
      { onSuccess: (forked: { id: string }) => void },
    ];
    expect(args).toEqual({ chatId: "chat-1" });
    expect("fromMessageId" in args).toBe(false);

    opts.onSuccess({ id: "cloned-chat-9" });
    expect(routerPushMock).toHaveBeenCalledWith("/chat/cloned-chat-9");
  });
});

describe("ChatItem — activity indicator (design's chatStatusEl)", () => {
  it("renders the unread badge when the chat has an unseen background completion", () => {
    mockCompletedChats = new Set(["chat-1"]);
    renderChatItem();

    expect(screen.getByLabelText("Unread reply")).toBeTruthy();
    expect(screen.queryByLabelText("Generating response")).toBeNull();
  });

  it("renders the processing badge while a run is active for the chat", () => {
    mockActiveChatIds = new Set(["chat-1"]);
    renderChatItem();

    expect(screen.getByLabelText("Generating response")).toBeTruthy();
    expect(screen.queryByLabelText("Unread reply")).toBeNull();
  });

  it("renders no badge for an idle chat (neither unread nor processing)", () => {
    renderChatItem();

    expect(screen.queryByLabelText("Unread reply")).toBeNull();
    expect(screen.queryByLabelText("Generating response")).toBeNull();
  });

  it("prefers processing over unread when both are true for the same chat", () => {
    mockCompletedChats = new Set(["chat-1"]);
    mockActiveChatIds = new Set(["chat-1"]);
    renderChatItem();

    expect(screen.getByLabelText("Generating response")).toBeTruthy();
    expect(screen.queryByLabelText("Unread reply")).toBeNull();
  });
});
