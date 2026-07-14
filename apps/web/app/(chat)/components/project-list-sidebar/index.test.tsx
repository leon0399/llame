// @vitest-environment jsdom

/**
 * Render-level proof for the project rail's live pin toggle (rework-item-
 * pinning replaces the "Pin — coming soon" disabled placeholder) and the
 * two-server-query Pinned/All projects grouping (mirroring ChatList's
 * architecture — retires bug #204 by construction).
 */

import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider } from "@workspace/ui/components/sidebar";

const pinMutateMock = vi.fn();
const unpinMutateMock = vi.fn();

vi.mock("@/lib/services/pins/mutations", () => ({
  usePinItem: () => ({ mutate: pinMutateMock, isPending: false }),
  useUnpinItem: () => ({ mutate: unpinMutateMock, isPending: false }),
}));

type MockProjectsState = {
  pinnedOnly: unknown[] | undefined;
  pinnedExclude: unknown[] | undefined;
  isLoading: boolean;
};
let mockProjects: MockProjectsState = {
  pinnedOnly: undefined,
  pinnedExclude: undefined,
  isLoading: false,
};
vi.mock("@/lib/services/project/queries", () => ({
  useProjectsQuery: (filters?: { pinned?: string }) => {
    const isPinned = filters?.pinned === "only";
    const data = isPinned
      ? mockProjects.pinnedOnly
      : mockProjects.pinnedExclude;
    return { data, isLoading: mockProjects.isLoading };
  },
}));

vi.mock("@/lib/services/project/mutations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/project/mutations")>();
  return {
    ...actual,
    useSetProjectArchive: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

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

  // jsdom doesn't implement ResizeObserver — Radix's Tooltip (@radix-ui/
  // react-use-size) instantiates one on mount.
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (
      globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }
    ).ResizeObserver = ResizeObserverStub;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

function project(overrides: Partial<Record<string, unknown>> = {}) {
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

function renderSidebar() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <ProjectListSidebar />
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  pinMutateMock.mockReset();
  unpinMutateMock.mockReset();
  mockProjects = {
    pinnedOnly: undefined,
    pinnedExclude: undefined,
    isLoading: false,
  };
  cleanup();
});

describe("ProjectListSidebar — pin toggle (unified /api/v1/pins resource)", () => {
  it("unpinned project: clicking Pin pins it with a synthesized {id, name} card", async () => {
    mockProjects = {
      pinnedOnly: [],
      pinnedExclude: [project({ id: "p1", name: "Acme" })],
      isLoading: false,
    };
    const user = userEvent.setup();
    renderSidebar();

    await user.click(await screen.findByRole("button", { name: "Pin" }));

    expect(pinMutateMock).toHaveBeenCalledWith({
      itemType: "project",
      itemId: "p1",
      card: { id: "p1", name: "Acme", archivedAt: null },
    });
    expect(unpinMutateMock).not.toHaveBeenCalled();
  });

  it("pinned project: clicking Unpin unpins it", async () => {
    mockProjects = {
      pinnedOnly: [project({ id: "p1", name: "Acme" })],
      pinnedExclude: [],
      isLoading: false,
    };
    const user = userEvent.setup();
    renderSidebar();

    await user.click(await screen.findByRole("button", { name: "Unpin" }));

    expect(unpinMutateMock).toHaveBeenCalledWith({
      itemType: "project",
      itemId: "p1",
    });
    expect(pinMutateMock).not.toHaveBeenCalled();
  });
});

describe("ProjectListSidebar — Pinned / All projects grouping (two-server-query)", () => {
  it("splits into a Pinned group and an All projects group with separate server queries", async () => {
    mockProjects = {
      pinnedOnly: [project({ id: "p1", name: "Pinned project" })],
      pinnedExclude: [project({ id: "p2", name: "Plain project" })],
      isLoading: false,
    };

    renderSidebar();

    expect(await screen.findByText("Pinned")).toBeTruthy();
    expect(screen.getByText("All projects")).toBeTruthy();
    expect(screen.getByText("Pinned project")).toBeTruthy();
    expect(screen.getByText("Plain project")).toBeTruthy();
  });

  it("shows no Pinned group and no 'All projects' label when nothing is pinned", async () => {
    mockProjects = {
      pinnedOnly: [],
      pinnedExclude: [project({ id: "p1", name: "Plain project" })],
      isLoading: false,
    };

    renderSidebar();

    expect(await screen.findByText("Plain project")).toBeTruthy();
    expect(screen.queryByText("Pinned")).toBeNull();
    expect(screen.queryByText("All projects")).toBeNull();
  });
});
