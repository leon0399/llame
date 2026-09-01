// @vitest-environment jsdom

/**
 * Data-flow coverage for MemorySection's query/mutation states — loading,
 * load error (with a working retry), toggle-and-save, and save error. Real
 * hooks run against a stubbed globalThis.fetch, no first-party module
 * mocking. Render/interaction detail for the switch itself lives in this
 * component's own memory-section.stories.tsx (docs/testing.md rule 5).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

import { MemorySection } from "./memory-section";

function switchChecked(el: Element) {
  return el.getAttribute("aria-checked") === "true";
}

function renderSection(
  getHandler: () => Response | Promise<Response>,
  patchHandler?: (request: Request) => Response | Promise<Response>,
) {
  const fetchMock = stubFetch();
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname !== "/api/v1/me/memory") {
      throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
    }
    if (request.method === "GET") return getHandler();
    if (request.method === "PATCH" && patchHandler)
      return patchHandler(request);
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemorySection />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("MemorySection", () => {
  it("shows a retryable error alert when the load fails, and recovers on retry", async () => {
    let attempt = 0;
    renderSection(() => {
      attempt += 1;
      return attempt === 1
        ? new Response(null, { status: 500 })
        : jsonResponse({ shareRecentChats: false });
    });

    await waitFor(() =>
      expect(
        screen.getByText("Could not load your memory settings."),
      ).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Share my recent chats" }),
      ).toBeTruthy(),
    );
  });

  it("toggles the switch, PATCHes shareRecentChats, and clears on success", async () => {
    // Mutable, not a constant response: onSettled always refetches, so a
    // fixed GET body would silently overwrite the just-saved value back to
    // its old state once that refetch lands.
    let serverState = { shareRecentChats: false };
    const fetchMock = renderSection(
      () => jsonResponse(serverState),
      async (request) => {
        serverState = await request.clone().json();
        return jsonResponse(serverState);
      },
    );

    const toggle = await screen.findByRole("switch", {
      name: "Share my recent chats",
    });
    expect(switchChecked(toggle)).toBe(false);

    fireEvent.click(toggle);

    await waitFor(() => expect(switchChecked(toggle)).toBe(true));
    // SAFETY: stubFetch's mock always receives a Request as its first arg
    // (see renderSection's own reconstruction above).
    const patchCall = fetchMock.mock.calls.find(
      (call) => (call[0] as Request).method === "PATCH",
    );
    expect(patchCall).toBeDefined();
    // SAFETY: filtered to a PATCH call above, which always carries a Request.
    const patchRequest = patchCall![0] as Request;
    expect(await patchRequest.clone().json()).toEqual({
      shareRecentChats: true,
    });
  });

  it("shows the save-failed alert when the PATCH rejects", async () => {
    renderSection(
      () => jsonResponse({ shareRecentChats: false }),
      () => Promise.resolve(new Response(null, { status: 500 })),
    );

    const toggle = await screen.findByRole("switch", {
      name: "Share my recent chats",
    });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(screen.getByText("Could not save. Try again.")).toBeTruthy(),
    );
  });
});
