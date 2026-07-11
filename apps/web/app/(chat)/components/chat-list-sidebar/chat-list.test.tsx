// @vitest-environment jsdom

/**
 * Render-level proof for the P1 sidebar-filing fix: a chat filed into a
 * project must never render NOWHERE. `ProjectsSection` only renders chats
 * keyed by the loaded `projects` list, so a chat referencing a project id
 * that isn't in that list (a `useProjects` error/desync, or a stale filed
 * chat pointing at a deleted project) must fold back into the time-grouped
 * list instead of disappearing.
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

describe("ChatList — orphaned filed chats", () => {
  it("renders a filed chat under its project when the project is loaded", async () => {
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

    expect(await screen.findByText("Acme")).toBeTruthy();
    expect(screen.getByText("Filed chat")).toBeTruthy();
  });

  it("folds a filed chat into the time-grouped list when its project isn't loaded (useProjects errored)", async () => {
    mockChats = {
      data: { pages: [[makeChat({ id: "c1", projectId: "missing-project" })]] },
      isLoading: false,
    };
    mockProjects = { data: undefined, isLoading: false, isError: true };

    renderChatList();

    // The chat still renders — folded into the time-grouped section —
    // rather than disappearing because "missing-project" isn't in the
    // loaded project list.
    expect(await screen.findByText("Filed chat")).toBeTruthy();
    expect(screen.queryByText("Acme")).toBeNull();
  });

  it("folds a filed chat back in when its project was deleted out from under it (desync)", async () => {
    // The chats query still reports the chat as filed into "deleted-project",
    // but the (successful) projects query no longer includes it.
    mockChats = {
      data: {
        pages: [[makeChat({ id: "c1", projectId: "deleted-project" })]],
      },
      isLoading: false,
    };
    mockProjects = { data: [], isLoading: false, isError: false };

    renderChatList();

    expect(await screen.findByText("Filed chat")).toBeTruthy();
  });

  it("shows the loading skeleton during the genuine initial load, not a fallback fold", () => {
    mockChats = { data: undefined, isLoading: true };
    mockProjects = { data: undefined, isLoading: true, isError: false };

    renderChatList();

    expect(screen.queryByText("Filed chat")).toBeNull();
  });
});
