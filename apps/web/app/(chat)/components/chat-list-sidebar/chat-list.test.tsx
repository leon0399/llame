// @vitest-environment jsdom

/**
 * Render-level proof that the chats rail is a pure time-grouped list: every
 * chat renders there regardless of its project filing (project grouping is
 * the /projects section's job), so no projects-query state — loaded, errored,
 * or desynced — can make a chat disappear from this list.
 */

import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider } from "@workspace/ui/components/sidebar";

type MockChatsState = {
  data: { pages: unknown[][] } | undefined;
  isLoading: boolean;
};
let mockChats: MockChatsState = { data: undefined, isLoading: false };
vi.mock("@/lib/services/chat/queries", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/chat/queries")>();
  return {
    ...actual,
    useChatsQuery: () => ({
      data: mockChats.data,
      isLoading: mockChats.isLoading,
      hasData: (mockChats.data?.pages.flat().length ?? 0) > 0,
    }),
  };
});

type MockProjectsState = {
  data: unknown[] | undefined;
  isLoading: boolean;
  isError: boolean;
};
let mockProjects: MockProjectsState = {
  data: undefined,
  isLoading: false,
  isError: false,
};
vi.mock("@/lib/services/project/queries", () => ({
  useProjects: () => mockProjects,
}));

vi.mock("@/contexts/chat-context", () => ({
  useChatContext: () => ({ activeChatId: null, setActiveChatId: vi.fn() }),
}));
// ChatItem reads this context for its unread/processing badge — isolate
// from ActiveRunsProvider's real polling, same convention as chat-item.test.tsx.
vi.mock("@/contexts/active-runs-context", () => ({
  useActiveRuns: () => ({
    completedChats: new Set<string>(),
    activeChatIds: new Set<string>(),
  }),
}));
vi.mock("@/lib/services/chat/fork", () => ({
  useForkChat: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

import { ChatList } from "./chat-list";

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
  // DropdownMenu/Tooltip rely on.
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

function renderChatList() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <ChatList />
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

function makeChat(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "chat-1",
    title: "Filed chat",
    lastMessage: null,
    visibility: "private" as const,
    pinnedAt: null,
    projectId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  mockChats = { data: undefined, isLoading: false };
  mockProjects = { data: undefined, isLoading: false, isError: false };
  cleanup();
});

describe("ChatList — pure time-grouped list (no project grouping)", () => {
  it("renders a filed chat in the time-grouped list, with no project group header", async () => {
    mockChats = {
      data: { pages: [[makeChat({ id: "c1", projectId: "p1" })]] },
      isLoading: false,
    };
    mockProjects = {
      data: [
        {
          id: "p1",
          ownerUserId: "u1",
          name: "Acme",
          createdAt: "",
          updatedAt: "",
        },
      ],
      isLoading: false,
      isError: false,
    };

    renderChatList();

    expect(await screen.findByText("Filed chat")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    // No per-project section in this rail — that lives at /projects.
    expect(screen.queryByText("Acme")).toBeNull();
  });

  it("renders a filed chat even when the projects query errored", async () => {
    mockChats = {
      data: { pages: [[makeChat({ id: "c1", projectId: "missing-project" })]] },
      isLoading: false,
    };
    mockProjects = { data: undefined, isLoading: false, isError: true };

    renderChatList();

    expect(await screen.findByText("Filed chat")).toBeTruthy();
  });

  it("does not wait for the projects query to render chats", async () => {
    mockChats = {
      data: { pages: [[makeChat({ id: "c1", projectId: null })]] },
      isLoading: false,
    };
    mockProjects = { data: undefined, isLoading: true, isError: false };

    renderChatList();

    expect(await screen.findByText("Filed chat")).toBeTruthy();
  });

  it("shows the loading skeleton while chats load", () => {
    mockChats = { data: undefined, isLoading: true };
    mockProjects = { data: undefined, isLoading: false, isError: false };

    renderChatList();

    expect(screen.queryByText("Filed chat")).toBeNull();
  });
});
