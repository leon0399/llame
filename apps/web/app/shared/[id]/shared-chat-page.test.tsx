// @vitest-environment jsdom

/**
 * next/navigation is the external boundary (permitted mock target) — a
 * client page's usePathname/useRouter have no in-process seam otherwise.
 * Everything else (fetchAllSharedMessages's pagination walk, useMeOptional,
 * useForkSharedChat) runs for real against a stubbed globalThis.fetch, so
 * this proves the actual requests the page sends, not an echoed mock.
 */

import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/shared/chat-1",
  useRouter: () => ({ push: routerPushMock }),
}));

import SharedChatPage from "./page";

let fetchMock: Mock<typeof fetch>;
let meHandler: () => Promise<Response>;

function sharedChatFixture(
  overrides: {
    title?: string | null;
    messages?: Array<unknown>;
  } = {},
) {
  return {
    id: "chat-1",
    // "title" in overrides, not `?? "A shared chat"` — an explicit `null`
    // override (the untitled-chat case) must not fall back to the default.
    title: "title" in overrides ? overrides.title : "A shared chat",
    messages: overrides.messages ?? [
      {
        id: "m1",
        seq: 1,
        role: "user",
        parts: [{ type: "text", text: "Hello there" }],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

function stubNetwork() {
  fetchMock = stubFetch();
  meHandler = () => Promise.resolve(new Response(null, { status: 401 }));
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/auth/v1/me") return meHandler();
    if (pathname === "/api/v1/shared/chats/chat-1/forks") {
      return jsonResponse({ id: "forked-1" });
    }
    if (pathname === "/api/v1/shared/chats/chat-1") {
      return jsonResponse(sharedChatFixture());
    }
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
}

async function renderPage() {
  const queryClient = new QueryClient();
  // Suspense boundary matches what the App Router provides around a client
  // page: `use(params)` suspends on the first render tick even for an
  // already-resolved promise, since React only observes settlement after a
  // microtask. `act(async …)` (not the synchronous `render()` alone) is what
  // flushes that resolution before the test makes its first assertion.
  await act(async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={null}>
          <SharedChatPage params={Promise.resolve({ id: "chat-1" })} />
        </Suspense>
      </QueryClientProvider>,
    );
  });
  return { queryClient };
}

beforeEach(() => {
  stubNetwork();
});

afterEach(() => {
  routerPushMock.mockReset();
  vi.unstubAllGlobals();
  cleanup();
});

describe("SharedChatPage", () => {
  it("renders the title and message text once the fetch resolves", async () => {
    await renderPage();

    await waitFor(() => expect(screen.getByText("A shared chat")).toBeTruthy());
    expect(screen.getByText("Hello there")).toBeTruthy();
  });

  it("shows a loading state while the fetch is still in flight", async () => {
    let resolveChat!: (response: Response) => void;
    const pendingChat = new Promise<Response>((resolve) => {
      resolveChat = resolve;
    });
    fetchMock.mockImplementation(async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const { pathname } = new URL(request.url);
      if (pathname === "/auth/v1/me")
        return new Response(null, { status: 401 });
      if (pathname === "/api/v1/shared/chats/chat-1") return pendingChat;
      throw new Error(`unrouted fetch: ${pathname}`);
    });

    await renderPage();

    expect(screen.getByText("Loading…")).toBeTruthy();

    resolveChat(jsonResponse(sharedChatFixture()));
    await waitFor(() => expect(screen.getByText("A shared chat")).toBeTruthy());
  });

  it("shows the untitled placeholder when the chat has no title yet", async () => {
    fetchMock.mockImplementation(async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const { pathname } = new URL(request.url);
      if (pathname === "/auth/v1/me")
        return new Response(null, { status: 401 });
      if (pathname === "/api/v1/shared/chats/chat-1")
        return jsonResponse(sharedChatFixture({ title: null }));
      throw new Error(`unrouted fetch: ${pathname}`);
    });

    await renderPage();

    await waitFor(() => expect(screen.getByText("Untitled chat")).toBeTruthy());
  });

  it("shows the unavailable state on a fetch error", async () => {
    fetchMock.mockImplementation(async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const { pathname } = new URL(request.url);
      if (pathname === "/auth/v1/me")
        return new Response(null, { status: 401 });
      if (pathname === "/api/v1/shared/chats/chat-1")
        return new Response(null, { status: 404 });
      throw new Error(`unrouted fetch: ${pathname}`);
    });

    await renderPage();

    await waitFor(() =>
      expect(screen.getByText("This chat isn’t available")).toBeTruthy(),
    );
  });

  it("shows a login link (not a fork button) for a signed-out visitor", async () => {
    await renderPage();

    await waitFor(() => expect(screen.getByText("A shared chat")).toBeTruthy());
    const loginLink = screen.getByText("Log in to continue");
    expect(loginLink.getAttribute("href")).toBe(
      "/login?callbackUrl=%2Fshared%2Fchat-1",
    );
    expect(screen.queryByText("Fork to continue")).toBeNull();
  });

  it("forks the chat and navigates to it when a signed-in visitor clicks Fork", async () => {
    meHandler = () =>
      Promise.resolve(
        jsonResponse({
          id: "u1",
          name: "Leo",
          email: "leo@example.com",
          emailVerified: null,
          image: null,
        }),
      );

    await renderPage();

    await waitFor(() => expect(screen.getByText("A shared chat")).toBeTruthy());
    const forkButton = await screen.findByText("Fork to continue");

    await act(async () => {
      forkButton.click();
    });

    await waitFor(() =>
      expect(routerPushMock).toHaveBeenCalledWith("/chat/forked-1"),
    );
  });
});
