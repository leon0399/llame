// @vitest-environment jsdom

/**
 * Render-level proof that the chats rail is a pure time-grouped list: every
 * chat renders there regardless of its project filing (project grouping is
 * the /projects section's job), so no projects-query state — loaded, errored,
 * or desynced — can make a chat disappear from this list.
 *
 * As of the archive refactor (PR #210), the component splits into two
 * server-driven queries:
 *   1. Pinned section — useChatsQuery({ pinned: "only" })
 *   2. All   section  — useChatsQuery({ pinned: "exclude" })
 * Both are backed by mock data separately.
 */

import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider } from "@workspace/ui/components/sidebar";

type MockChatsState = {
  pinnedOnly: { pages: unknown[][] } | undefined;
  pinnedExclude: { pages: unknown[][] } | undefined;
  isLoading: boolean;
};
let mockChats: MockChatsState = {
  pinnedOnly: undefined,
  pinnedExclude: undefined,
  isLoading: false,
};
vi.mock("@/lib/services/chat/queries", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/chat/queries")>();
  return {
    ...actual,
    useChatsQuery: (filters?: { pinned?: string }) => {
      const isPinned = filters?.pinned === "only";
      const data = isPinned ? mockChats.pinnedOnly : mockChats.pinnedExclude;
      return {
        data,
        isLoading: mockChats.isLoading,
        hasData: (data?.pages.flat().length ?? 0) > 0,
      };
    },
  };
});

type MockProjectsState = {
  data: unknown[] | undefined;
  isLoading: boolean;
};
let mockProjects: MockProjectsState = {
  data: undefined,
  isLoading: false,
};
vi.mock("@/lib/services/project/queries", () => ({
  useProjects: () => mockProjects,
}));

// Pins is the sole source of pin state (design D5) — isolate from the real
// network-backed usePins() so this "pure time-grouped list" suite never
// depends on pin data; selectPinnedChatMap stays real (pure function).
type MockPinsState = { data: unknown[] | undefined };
let mockPins: MockPinsState = { data: undefined };
vi.mock("@/lib/services/pins/queries", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/pins/queries")>();
  return { ...actual, usePins: () => mockPins };
});

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
vi.mock("@/lib/services/chat/management", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/chat/management")>();
  return {
    ...actual,
    useSetChatArchive: () => ({ mutate: vi.fn(), isPending: false }),
  };
});
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

  // jsdom doesn't implement the Pointer Events capture API Base UI's
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
    projectId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  mockChats = {
    pinnedOnly: undefined,
    pinnedExclude: undefined,
    isLoading: false,
  };
  mockProjects = { data: undefined, isLoading: false };
  mockPins = { data: undefined };
  cleanup();
});

describe("ChatList — pure time-grouped list (no project grouping)", () => {
  it("renders a filed chat in the time-grouped All section, with no project group header", async () => {
    mockChats = {
      pinnedOnly: { pages: [[]] },
      pinnedExclude: {
        pages: [[makeChat({ id: "c1", projectId: "p1" })]],
      },
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
    };

    renderChatList();

    expect(await screen.findByText("Filed chat")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    // No per-project section in this rail — that lives at /projects.
    expect(screen.queryByText("Acme")).toBeNull();
  });

  it("renders a filed chat even when the projects query errored", async () => {
    mockChats = {
      pinnedOnly: { pages: [[]] },
      pinnedExclude: {
        pages: [[makeChat({ id: "c1", projectId: "missing-project" })]],
      },
      isLoading: false,
    };
    mockProjects = { data: undefined, isLoading: false };

    renderChatList();

    expect(await screen.findByText("Filed chat")).toBeTruthy();
  });

  it("does not wait for the projects query to render chats", async () => {
    mockChats = {
      pinnedOnly: { pages: [[]] },
      pinnedExclude: {
        pages: [[makeChat({ id: "c1", projectId: null })]],
      },
      isLoading: false,
    };
    mockProjects = { data: undefined, isLoading: true };

    renderChatList();

    expect(await screen.findByText("Filed chat")).toBeTruthy();
  });

  it("shows the loading skeleton while chats load", () => {
    mockChats = {
      pinnedOnly: undefined,
      pinnedExclude: undefined,
      isLoading: true,
    };
    mockProjects = { data: undefined, isLoading: false };

    renderChatList();

    expect(screen.queryByText("Filed chat")).toBeNull();
  });
});

describe("ChatList — Pinned section driven by server query (design D5)", () => {
  it("renders a Pinned group above time-grouped All when pinned-only data is non-empty", async () => {
    mockChats = {
      pinnedOnly: {
        pages: [[makeChat({ id: "c1", title: "Pinned chat" })]],
      },
      pinnedExclude: {
        pages: [[makeChat({ id: "c2", title: "Unpinned chat" })]],
      },
      isLoading: false,
    };

    renderChatList();

    expect(await screen.findByText("Pinned")).toBeTruthy();
    expect(screen.getByText("Pinned chat")).toBeTruthy();
    expect(screen.getByText("Unpinned chat")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
  });

  it("shows no Pinned group when the pinned-only query returns empty", async () => {
    mockChats = {
      pinnedOnly: { pages: [[]] },
      pinnedExclude: {
        pages: [[makeChat({ id: "c1", title: "Lonely chat" })]],
      },
      isLoading: false,
    };

    renderChatList();

    expect(await screen.findByText("Lonely chat")).toBeTruthy();
    expect(screen.queryByText("Pinned")).toBeNull();
  });

  it("shows empty-state when both queries return no data", async () => {
    mockChats = {
      pinnedOnly: { pages: [[]] },
      pinnedExclude: { pages: [[]] },
      isLoading: false,
    };

    renderChatList();

    expect(
      await screen.findByText(
        "Your conversations will appear here once you start chatting!",
      ),
    ).toBeTruthy();
  });
});
