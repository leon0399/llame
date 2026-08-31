// @vitest-environment jsdom

/**
 * Render-level proof for the project rail's live pin toggle (rework-item-
 * pinning replaces the "Pin — coming soon" disabled placeholder) and the
 * two-server-query Pinned/All projects grouping (mirroring ChatList's
 * architecture — retires bug #204 by construction).
 *
 * usePinItem/useUnpinItem, useProjectsQuery, and useSetProjectArchive run for
 * real against a stubbed globalThis.fetch routed by pathname (GET
 * /api/v1/projects, PUT/DELETE /api/v1/pins/project/:id) — a "Pin" click is
 * proved by the real PUT request AND the real optimistic write into the pins
 * query cache (the synthesized {id, name, archivedAt} card), not an echoed
 * mock-call assertion. Only next/navigation (no in-process seam) is mocked.
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
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Mock } from "vitest";
import { SidebarProvider } from "@workspace/ui/components/sidebar";

import type { ProjectResponse } from "@/lib/api/generated/models";
import { pinQueryKeys } from "@/lib/services/pins/queries";
import type { PinnedItem } from "@/lib/services/pins/types";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
}));

import { ProjectListSidebar } from "./index";

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

  // jsdom doesn't implement ResizeObserver — Base UI's Tooltip
  // instantiates one on mount.
  if (!("ResizeObserver" in globalThis)) {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverStub {
        constructor(_callback: ResizeObserverCallback) {}
        observe(_target: Element, _options?: ResizeObserverOptions): void {}
        unobserve(_target: Element): void {}
        disconnect(): void {}
      },
    );
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

function project(overrides: Partial<ProjectResponse> = {}): ProjectResponse {
  return {
    id: "p1",
    ownerUserId: "u1",
    name: "Acme",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
    ...overrides,
  };
}

let fetchMock: Mock<typeof fetch>;
// Per-test-overridable buckets for the sidebar's two server-driven project
// queries (?pinned=only vs ?pinned=exclude).
let pinnedOnlyProjects: Array<ProjectResponse>;
let pinnedExcludeProjects: Array<ProjectResponse>;

function stubProjectsNetwork() {
  fetchMock = stubFetch();
  pinnedOnlyProjects = [];
  pinnedExcludeProjects = [];
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname, searchParams } = new URL(request.url);
    if (pathname === "/api/v1/projects") {
      return jsonResponse<Array<ProjectResponse>>(
        searchParams.get("pinned") === "only"
          ? pinnedOnlyProjects
          : pinnedExcludeProjects,
      );
    }
    const pinMatch = /^\/api\/v1\/pins\/project\/(.+)$/.exec(pathname);
    if (pinMatch && request.method === "PUT") {
      const itemId = pinMatch[1]!;
      return jsonResponse({
        itemType: "project",
        itemId,
        pinnedAt: "2026-01-01T00:00:00.000Z",
        item: { id: itemId, name: "Acme", archivedAt: null },
      });
    }
    if (pinMatch && request.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
}

/** Wait for and return the first stubbed-fetch Request sent with `method` —
 * distinguishes the pin/unpin mutation from the two list GETs already in
 * flight from mount. */
async function findRequestByMethod(
  mock: Mock<typeof fetch>,
  method: string,
): Promise<Request> {
  await waitFor(() =>
    expect(
      mock.mock.calls.some(
        ([req]) => req instanceof Request && req.method === method,
      ),
    ).toBe(true),
  );
  return mock.mock.calls
    .map(([req]) => req)
    .find(
      (req): req is Request => req instanceof Request && req.method === method,
    )!;
}

function renderSidebar() {
  const queryClient = new QueryClient();
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <ProjectListSidebar />
        </SidebarProvider>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  stubProjectsNetwork();
});

afterEach(() => {
  // NOT vi.unstubAllGlobals() — beforeAll's ResizeObserver/pointer-capture
  // stubs must survive across tests; beforeEach's stubFetch() already
  // replaces fetch fresh each test.
  cleanup();
});

describe("ProjectListSidebar — pin toggle (unified /api/v1/pins resource)", () => {
  it("unpinned project: clicking Pin pins it with a synthesized {id, name} card", async () => {
    pinnedExcludeProjects = [project({ id: "p1", name: "Acme" })];
    const user = userEvent.setup();
    const { queryClient } = renderSidebar();

    await user.click(await screen.findByRole("button", { name: "Pin" }));

    // The optimistic write real usePinItem's onMutate makes into the pins
    // cache, synthesizing the card from the row the owner clicked on.
    await waitFor(() =>
      expect(
        queryClient.getQueryData<Array<PinnedItem>>(pinQueryKeys.list()),
      ).toMatchObject([
        {
          itemType: "project",
          itemId: "p1",
          item: { id: "p1", name: "Acme", archivedAt: null },
        },
      ]),
    );
    // The two GET /api/v1/projects list requests from mount are already in
    // flight — find the pin PUT specifically, by method.
    const pinRequest = await findRequestByMethod(fetchMock, "PUT");
    expect(new URL(pinRequest.url).pathname).toBe("/api/v1/pins/project/p1");
  });

  it("pinned project: clicking Unpin unpins it", async () => {
    pinnedOnlyProjects = [project({ id: "p1", name: "Acme" })];
    const user = userEvent.setup();
    renderSidebar();

    await user.click(await screen.findByRole("button", { name: "Unpin" }));

    const unpinRequest = await findRequestByMethod(fetchMock, "DELETE");
    expect(new URL(unpinRequest.url).pathname).toBe("/api/v1/pins/project/p1");
  });
});

describe("ProjectListSidebar — Pinned / All projects grouping (two-server-query)", () => {
  it("splits into a Pinned group and an All projects group with separate server queries", async () => {
    pinnedOnlyProjects = [project({ id: "p1", name: "Pinned project" })];
    pinnedExcludeProjects = [project({ id: "p2", name: "Plain project" })];

    renderSidebar();

    expect(await screen.findByText("Pinned")).toBeTruthy();
    expect(screen.getByText("All projects")).toBeTruthy();
    expect(screen.getByText("Pinned project")).toBeTruthy();
    expect(screen.getByText("Plain project")).toBeTruthy();
  });

  it("shows no Pinned group and no 'All projects' label when nothing is pinned", async () => {
    pinnedExcludeProjects = [project({ id: "p1", name: "Plain project" })];

    renderSidebar();

    expect(await screen.findByText("Plain project")).toBeTruthy();
    expect(screen.queryByText("Pinned")).toBeNull();
    expect(screen.queryByText("All projects")).toBeNull();
  });
});
