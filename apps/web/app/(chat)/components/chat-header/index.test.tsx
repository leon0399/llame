// @vitest-environment jsdom

/**
 * ChatHeader mocks next/navigation (the router, docs/testing.md rule 5's own
 * carve-out for staying jsdom over a story) but otherwise runs its real
 * useChatQuery/useChatsQuery hooks against a stubbed globalThis.fetch, no
 * first-party module mocking. Reduced-motion is forced on so useTypewriter
 * settles synchronously to its target instead of animating (its timer chain
 * is separately covered by use-typewriter.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider } from "@workspace/ui/components/sidebar";

import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";
import type { ChatListItemResponse } from "@/lib/api/generated/models";
import { chatQueryKeys } from "@/lib/services/chat/queries";

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn<() => string>(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

import { ChatHeader } from "./index";

function chatRow(
  overrides: Partial<ChatListItemResponse> & Pick<ChatListItemResponse, "id">,
): ChatListItemResponse {
  return {
    ownerUserId: "u1",
    title: null,
    visibility: "private",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    projectId: null,
    lastMessage: null,
    ...overrides,
  };
}

/** Handlers for the two list queries ChatHeader always issues, plus an
 *  optional GET /chats/:id fallback — undefined means "must not be called".
 *  `seedAllCache` pre-populates the "all chats" query cache before the first
 *  render, the same as a warm cache from a prior sidebar navigation: without
 *  it, `chatFromList` is genuinely undefined (not yet "not found") on the
 *  first render, so `useResolvedChatTitle` also enables the detail fetch —
 *  real behavior, not something to work around inside the mock router. */
function renderHeader(
  handlers: {
    pinned?: Array<ChatListItemResponse>;
    all?: Array<ChatListItemResponse>;
    detail?: (id: string) => Response | Promise<Response>;
  },
  { seedAllCache = false }: { seedAllCache?: boolean } = {},
) {
  const fetchMock = stubFetch();
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname, searchParams } = new URL(request.url);

    if (pathname === "/api/v1/chats") {
      if (searchParams.get("pinned") === "only") {
        return jsonResponse(handlers.pinned ?? []);
      }
      if (searchParams.get("pinned") === "exclude") {
        return jsonResponse(handlers.all ?? []);
      }
    }
    const detailMatch = /^\/api\/v1\/chats\/([^/]+)$/.exec(pathname);
    if (detailMatch?.[1] && handlers.detail) {
      return handlers.detail(detailMatch[1]);
    }
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (seedAllCache) {
    queryClient.setQueryData(chatQueryKeys.infinite({ pinned: "exclude" }), {
      pages: [handlers.all ?? []],
      pageParams: [undefined],
    });
  }
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <ChatHeader />
      </SidebarProvider>
    </QueryClientProvider>,
  );
  return { fetchMock, ...view };
}

beforeEach(() => {
  document.title = "llame";
  // jsdom doesn't implement matchMedia (SidebarProvider's useIsMobile and
  // useTypewriter's reduced-motion check both read it). Force reduced motion
  // on so the typewriter settles synchronously rather than animating.
  window.matchMedia = (query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("ChatHeader", () => {
  it("renders nothing on a /projects route (that page owns its own header)", async () => {
    usePathnameMock.mockReturnValue("/projects/p1");
    renderHeader({});

    // Nothing to await on: the component returns null synchronously from
    // the pathname branch, before the query data even matters.
    expect(screen.queryByRole("banner")).toBeNull();
  });

  it("renders the shell with no title on a route with no active chat", async () => {
    usePathnameMock.mockReturnValue("/");
    const { container } = renderHeader({});

    await waitFor(() => expect(screen.getByRole("banner")).toBeTruthy());
    // The title span (not the trigger button's own sr-only label) is absent.
    expect(container.querySelector(".truncate")).toBeNull();
    expect(document.title).toBe("llame");
  });

  it("resolves the title from a warm sidebar list cache, without a detail fetch", async () => {
    usePathnameMock.mockReturnValue("/chat/chat-1");
    const { fetchMock } = renderHeader(
      { all: [chatRow({ id: "chat-1", title: "Existing chat" })] },
      { seedAllCache: true },
    );

    await waitFor(() => expect(screen.getByText("Existing chat")).toBeTruthy());
    expect(document.title).toBe("Existing chat");
    const requestedPaths = fetchMock.mock.calls.map(
      (_, index) => new URL(requestFromCall(fetchMock, index).url).pathname,
    );
    expect(requestedPaths).not.toContain("/api/v1/chats/chat-1");
  });

  it("falls back to GET /chats/:id for a chat absent from both list caches (archived-unpinned)", async () => {
    usePathnameMock.mockReturnValue("/chat/chat-2");
    renderHeader({
      detail: (id) => jsonResponse(chatRow({ id, title: "Archived chat" })),
    });

    await waitFor(() => expect(screen.getByText("Archived chat")).toBeTruthy());
    expect(document.title).toBe("Archived chat");
  });

  it("shows the untitled placeholder for a chat with a null title", async () => {
    usePathnameMock.mockReturnValue("/chat/chat-3");
    renderHeader({
      all: [chatRow({ id: "chat-3", title: null })],
    });

    await waitFor(() => expect(screen.getByText("New chat")).toBeTruthy());
  });

  it("restores the default document title when the header unmounts", async () => {
    usePathnameMock.mockReturnValue("/chat/chat-1");
    const { unmount } = renderHeader(
      { all: [chatRow({ id: "chat-1", title: "Existing chat" })] },
      { seedAllCache: true },
    );

    await waitFor(() => expect(document.title).toBe("Existing chat"));

    unmount();
    expect(document.title).toBe("llame");
  });
});
