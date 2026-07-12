// @vitest-environment jsdom

/**
 * Render-level proof for the project rail's live pin toggle (rework-item-
 * pinning replaces the "Pin — coming soon" disabled placeholder) and the
 * Pinned/All projects grouping (design D5 — pins is the sole source of pin
 * state, not a field on the project).
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

type MockPinsState = { data: unknown[] | undefined };
let mockPins: MockPinsState = { data: [] };
vi.mock("@/lib/services/pins/queries", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/pins/queries")>();
  return { ...actual, usePins: () => mockPins };
});

type MockProjectsState = { data: unknown[] | undefined; isLoading: boolean };
let mockProjects: MockProjectsState = { data: undefined, isLoading: false };
vi.mock("@/lib/services/project/queries", () => ({
  useProjects: () => mockProjects,
}));

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
  mockPins = { data: [] };
  mockProjects = { data: undefined, isLoading: false };
  cleanup();
});

describe("ProjectListSidebar — pin toggle (unified /api/v1/pins resource)", () => {
  it("unpinned project: clicking Pin pins it with a synthesized {id, name} card", async () => {
    mockProjects = {
      data: [project({ id: "p1", name: "Acme" })],
      isLoading: false,
    };
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Pin" }));

    expect(pinMutateMock).toHaveBeenCalledWith({
      itemType: "project",
      itemId: "p1",
      card: { id: "p1", name: "Acme" },
    });
    expect(unpinMutateMock).not.toHaveBeenCalled();
  });

  it("pinned project: clicking Unpin unpins it", async () => {
    mockProjects = {
      data: [project({ id: "p1", name: "Acme" })],
      isLoading: false,
    };
    mockPins = {
      data: [
        {
          itemType: "project",
          itemId: "p1",
          pinnedAt: new Date().toISOString(),
          item: { id: "p1", name: "Acme" },
        },
      ],
    };
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Unpin" }));

    expect(unpinMutateMock).toHaveBeenCalledWith({
      itemType: "project",
      itemId: "p1",
    });
    expect(pinMutateMock).not.toHaveBeenCalled();
  });
});

describe("ProjectListSidebar — Pinned / All projects grouping (design D5)", () => {
  it("splits into a Pinned group and an All projects group when some projects are pinned", async () => {
    mockProjects = {
      data: [
        project({ id: "p1", name: "Pinned project" }),
        project({ id: "p2", name: "Plain project" }),
      ],
      isLoading: false,
    };
    mockPins = {
      data: [
        {
          itemType: "project",
          itemId: "p1",
          pinnedAt: new Date().toISOString(),
          item: { id: "p1", name: "Pinned project" },
        },
      ],
    };

    renderSidebar();

    expect(await screen.findByText("Pinned")).toBeTruthy();
    expect(screen.getByText("All projects")).toBeTruthy();
    expect(screen.getByText("Pinned project")).toBeTruthy();
    expect(screen.getByText("Plain project")).toBeTruthy();
  });

  it("shows no Pinned group and no 'All projects' label when nothing is pinned", async () => {
    mockProjects = {
      data: [project({ id: "p1", name: "Plain project" })],
      isLoading: false,
    };
    mockPins = { data: [] };

    renderSidebar();

    expect(await screen.findByText("Plain project")).toBeTruthy();
    expect(screen.queryByText("Pinned")).toBeNull();
    expect(screen.queryByText("All projects")).toBeNull();
  });
});
