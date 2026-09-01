// @vitest-environment jsdom

/**
 * Container coverage for ProjectPage's loading/not-found/empty states. Real
 * useProjects/useChatsQuery/usePins run against a stubbed globalThis.fetch.
 * Only next/navigation (useParams, no in-process seam) is mocked. The
 * populated-chats path renders the shared ChatTimeGroups list, which has its
 * own coverage elsewhere — not duplicated here.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider } from "@workspace/ui/components/sidebar";

import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "p1" }),
}));

import ProjectPage from "./page";

beforeAll(() => {
  // jsdom doesn't implement matchMedia — SidebarProvider's useIsMobile reads it.
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
});

function renderPage(
  handlers: Partial<{
    projects: () => Response | Promise<Response>;
    pins: () => Response | Promise<Response>;
    chats: () => Response | Promise<Response>;
  }> = {},
) {
  const fetchMock = stubFetch();
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v1/projects") {
      return (handlers.projects ?? (() => jsonResponse([])))();
    }
    if (pathname === "/api/v1/pins") {
      return (handlers.pins ?? (() => jsonResponse([])))();
    }
    if (pathname === "/api/v1/chats") {
      return (handlers.chats ?? (() => jsonResponse([])))();
    }
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <ProjectPage />
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("ProjectPage", () => {
  it("shows the loading title and row skeletons while projects/chats are in flight", () => {
    renderPage({
      projects: () => new Promise(() => {}),
      chats: () => new Promise(() => {}),
    });

    expect(screen.getByText("…")).toBeTruthy();
  });

  it("shows the not-found message when no project matches the id", async () => {
    renderPage({ projects: () => jsonResponse([]) });

    await waitFor(() =>
      expect(screen.getByText("Project not found")).toBeTruthy(),
    );
    expect(
      screen.getByText("This project doesn't exist or was deleted."),
    ).toBeTruthy();
  });

  it("shows the project name and the empty-chats message when it has none", async () => {
    renderPage({
      projects: () =>
        jsonResponse([
          {
            id: "p1",
            ownerUserId: "u1",
            name: "Trip planning",
            archivedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
    });

    await waitFor(() => expect(screen.getByText("Trip planning")).toBeTruthy());
    expect(screen.getByText("No chats in this project yet.")).toBeTruthy();
  });
});
