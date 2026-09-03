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
 *
 * useChatsQuery, useProjects, usePins, and the real ActiveRunsProvider all
 * run for real against a stubbed globalThis.fetch, routed by pathname (+ the
 * pinned search param for GET /api/v1/chats). useForkChat/useSetChatArchive
 * are real too but never invoked (no mutation is triggered by these render-
 * only tests), so no route is needed for them. Only next/navigation (no
 * in-process seam) is mocked.
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
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Mock } from "vitest";
import { SidebarProvider } from "@workspace/ui/components/sidebar";

import type {
  ChatListItemResponse,
  ProjectResponse,
} from "@/lib/api/generated/models";
import { ActiveRunsProvider } from "@/contexts/active-runs-context";
import type { PinnedItem } from "@/lib/services/pins/types";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

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

let fetchMock: Mock<typeof fetch>;
// Per-test-overridable handlers for the four endpoints the rail queries.
// Left unresolved by default where a test needs a "still loading" state.
let pinnedOnlyHandler: () => Promise<Response>;
let pinnedExcludeHandler: () => Promise<Response>;
let projectsHandler: () => Promise<Response>;
let pinsHandler: () => Promise<Response>;

function stubChatListNetwork() {
  fetchMock = stubFetch();
  pinnedOnlyHandler = () =>
    Promise.resolve(jsonResponse<Array<ChatListItemResponse>>([]));
  pinnedExcludeHandler = () =>
    Promise.resolve(jsonResponse<Array<ChatListItemResponse>>([]));
  projectsHandler = () =>
    Promise.resolve(jsonResponse<Array<ProjectResponse>>([]));
  pinsHandler = () => Promise.resolve(jsonResponse<Array<PinnedItem>>([]));
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname, searchParams } = new URL(request.url);
    if (pathname === "/api/v1/me/runs") return jsonResponse([]);
    if (pathname === "/api/v1/projects") return projectsHandler();
    if (pathname === "/api/v1/pins") return pinsHandler();
    if (pathname === "/api/v1/chats") {
      return searchParams.get("pinned") === "only"
        ? pinnedOnlyHandler()
        : pinnedExcludeHandler();
    }
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
}

function renderChatList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveRunsProvider>
        <SidebarProvider>
          <ChatList />
        </SidebarProvider>
      </ActiveRunsProvider>
    </QueryClientProvider>,
  );
}

function makeChat(
  overrides: Partial<ChatListItemResponse> = {},
): ChatListItemResponse {
  return {
    id: "chat-1",
    ownerUserId: "u1",
    title: "Filed chat",
    lastMessage: null,
    visibility: "private",
    projectId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  stubChatListNetwork();
});

afterEach(() => {
  // NOT vi.unstubAllGlobals() — beforeAll's pointer-capture/scrollIntoView
  // stubs must survive across tests; beforeEach's stubFetch() already
  // replaces fetch fresh each test.
  cleanup();
});

describe("ChatList — pure time-grouped list (no project grouping)", () => {
  it("renders a filed chat in the time-grouped All section, with no project group header", async () => {
    pinnedExcludeHandler = () =>
      Promise.resolve(
        jsonResponse<Array<ChatListItemResponse>>([
          makeChat({ id: "c1", projectId: "p1" }),
        ]),
      );
    projectsHandler = () =>
      Promise.resolve(
        jsonResponse<Array<ProjectResponse>>([
          {
            id: "p1",
            ownerUserId: "u1",
            name: "Acme",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            archivedAt: null,
          },
        ]),
      );

    renderChatList();

    expect(await screen.findByText("Filed chat")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    // No per-project section in this rail — that lives at /projects.
    expect(screen.queryByText("Acme")).toBeNull();
  });

  it("renders a filed chat even when the projects query errored", async () => {
    pinnedExcludeHandler = () =>
      Promise.resolve(
        jsonResponse<Array<ChatListItemResponse>>([
          makeChat({ id: "c1", projectId: "missing-project" }),
        ]),
      );
    projectsHandler = () =>
      Promise.resolve(new Response(null, { status: 500 }));

    renderChatList();

    expect(await screen.findByText("Filed chat")).toBeTruthy();
  });

  it("does not wait for the projects query to render chats", async () => {
    pinnedExcludeHandler = () =>
      Promise.resolve(
        jsonResponse<Array<ChatListItemResponse>>([
          makeChat({ id: "c1", projectId: null }),
        ]),
      );
    // Still loading — never resolves within this test.
    projectsHandler = () => new Promise<Response>(() => {});

    renderChatList();

    expect(await screen.findByText("Filed chat")).toBeTruthy();
  });

  it("shows the loading skeleton while chats load", () => {
    // Still loading — never resolves within this test.
    pinnedOnlyHandler = () => new Promise<Response>(() => {});
    pinnedExcludeHandler = () => new Promise<Response>(() => {});

    renderChatList();

    expect(screen.queryByText("Filed chat")).toBeNull();
  });
});

describe("ChatList — Pinned section driven by server query (design D5)", () => {
  it("renders a Pinned group above time-grouped All when pinned-only data is non-empty", async () => {
    pinnedOnlyHandler = () =>
      Promise.resolve(
        jsonResponse<Array<ChatListItemResponse>>([
          makeChat({ id: "c1", title: "Pinned chat" }),
        ]),
      );
    pinnedExcludeHandler = () =>
      Promise.resolve(
        jsonResponse<Array<ChatListItemResponse>>([
          makeChat({ id: "c2", title: "Unpinned chat" }),
        ]),
      );

    renderChatList();

    expect(await screen.findByText("Pinned")).toBeTruthy();
    expect(screen.getByText("Pinned chat")).toBeTruthy();
    expect(screen.getByText("Unpinned chat")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
  });

  it("shows no Pinned group when the pinned-only query returns empty", async () => {
    pinnedExcludeHandler = () =>
      Promise.resolve(
        jsonResponse<Array<ChatListItemResponse>>([
          makeChat({ id: "c1", title: "Lonely chat" }),
        ]),
      );

    renderChatList();

    expect(await screen.findByText("Lonely chat")).toBeTruthy();
    expect(screen.queryByText("Pinned")).toBeNull();
  });

  it("shows empty-state when both queries return no data", async () => {
    renderChatList();

    expect(
      await screen.findByText(
        "Your conversations will appear here once you start chatting!",
      ),
    ).toBeTruthy();
  });
});
