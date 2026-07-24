// @vitest-environment jsdom

/**
 * Render-level proof for the rail's mixed chats+projects "Pinned" section
 * (AppShell.dc.html / design D5): sourced from the one GET /pins query,
 * ordered as the server returns it, hidden entirely when there are no pins.
 * Also covers the per-row "…" kebab menu (Unpin/Rename/Archive/
 * Delete — no separate hover pin/unpin button here, unlike ChatItem's/
 * ProjectItem's list rows), which is a deliberate SUBSET of those row menus —
 * the rail only has the lean RefCard, not the full chat/project, so
 * data-heavy chat actions (Move to project, Share, Export, Fork) have no
 * data to act on and are never rendered here.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider } from "@workspace/ui/components/sidebar";

type MockPinsState = { data: unknown[] | undefined };
let mockPins: MockPinsState = { data: undefined };
vi.mock("@/lib/services/pins/queries", () => ({
  usePins: () => mockPins,
}));

const unpinMutateMock = vi.fn();
// The rail only ever unpins (every row here is, by construction, already
// pinned) — usePinItem is unused by these rows but still imported by the
// module, so it's mocked too.
vi.mock("@/lib/services/pins/mutations", () => ({
  usePinItem: () => ({ mutate: vi.fn(), isPending: false }),
  useUnpinItem: () => ({ mutate: unpinMutateMock, isPending: false }),
}));

const archiveChatMutateMock = vi.fn();
vi.mock("@/lib/services/chat/management", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/chat/management")>();
  return {
    ...actual,
    useSetChatArchive: () => ({
      mutate: archiveChatMutateMock,
      isPending: false,
    }),
  };
});

const archiveProjectMutateMock = vi.fn();
vi.mock("@/lib/services/project/mutations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/project/mutations")>();
  return {
    ...actual,
    useSetProjectArchive: () => ({
      mutate: archiveProjectMutateMock,
      isPending: false,
    }),
  };
});

const routerPushMock = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  // DeleteChatDialog navigates away first when deleting the active chat.
  useRouter: () => ({ push: routerPushMock }),
}));

import { AppSidebarPinned } from "./app-sidebar-pinned";

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

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  // jsdom doesn't implement the Pointer Events capture API or ResizeObserver,
  // both of which Base UI's Tooltip (rendered by SidebarMenuButton's `tooltip`
  // prop) relies on.
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
});

function renderPinned() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <AppSidebarPinned />
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  mockPins = { data: undefined };
  unpinMutateMock.mockReset();
  cleanup();
});

describe("AppSidebarPinned", () => {
  it("renders nothing when there are no pins (no empty labelled group)", () => {
    mockPins = { data: [] };
    const { container } = render(<AppSidebarPinned />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while pins are loading (data undefined)", () => {
    mockPins = { data: undefined };
    const { container } = render(<AppSidebarPinned />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a mixed chats+projects Pinned section in server (pin-recency) order", () => {
    mockPins = {
      data: [
        {
          itemType: "project",
          itemId: "p1",
          pinnedAt: "2026-01-02T00:00:00.000Z",
          item: { id: "p1", name: "Acme relaunch", archivedAt: null },
        },
        {
          itemType: "chat",
          itemId: "c1",
          pinnedAt: "2026-01-01T00:00:00.000Z",
          item: { id: "c1", title: "Trip to Lisbon", archivedAt: null },
        },
      ],
    };

    renderPinned();

    expect(screen.getByText("Pinned")).toBeTruthy();
    const rows = screen.getAllByRole("link");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Acme relaunch",
      "Trip to Lisbon",
    ]);
    expect(rows[0].getAttribute("href")).toBe("/projects/p1");
    expect(rows[1].getAttribute("href")).toBe("/chat/c1");
  });

  it("renders the localized placeholder for an untitled pinned chat", () => {
    mockPins = {
      data: [
        {
          itemType: "chat",
          itemId: "c1",
          pinnedAt: "2026-01-01T00:00:00.000Z",
          item: { id: "c1", title: null, archivedAt: null },
        },
      ],
    };

    renderPinned();

    expect(screen.getByText("New chat")).toBeTruthy();
  });
});

describe("AppSidebarPinned — pinned chat row menu (mirrors ChatItem's row menu)", () => {
  it("the kebab menu exposes Unpin, Rename, Archive, and Delete — no chat-only data-heavy actions", async () => {
    mockPins = {
      data: [
        {
          itemType: "chat",
          itemId: "c1",
          pinnedAt: "2026-01-01T00:00:00.000Z",
          item: { id: "c1", title: "Trip to Lisbon", archivedAt: null },
        },
      ],
    };
    const user = userEvent.setup();
    renderPinned();

    await user.click(screen.getByRole("button", { name: /more/i }));

    expect(await screen.findByRole("menuitem", { name: "Unpin" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Archive" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Unarchive" })).toBeNull();
    // Data-heavy chat actions need the full chat (projectId, visibility, …),
    // which the rail's lean RefCard doesn't carry — never faked here.
    expect(screen.queryByRole("menuitem", { name: /project/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "Export as Markdown" }),
    ).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Fork" })).toBeNull();
  });

  it("the kebab menu's Unpin item unpins the chat", async () => {
    mockPins = {
      data: [
        {
          itemType: "chat",
          itemId: "c1",
          pinnedAt: "2026-01-01T00:00:00.000Z",
          item: { id: "c1", title: "Trip to Lisbon", archivedAt: null },
        },
      ],
    };
    const user = userEvent.setup();
    renderPinned();

    await user.click(screen.getByRole("button", { name: /more/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Unpin" }));

    expect(unpinMutateMock).toHaveBeenCalledWith({
      itemType: "chat",
      itemId: "c1",
    });
  });
});

describe("AppSidebarPinned — pinned project row menu (mirrors ProjectItem's row menu)", () => {
  it("the kebab menu exposes Unpin, Rename, Archive, and Delete", async () => {
    mockPins = {
      data: [
        {
          itemType: "project",
          itemId: "p1",
          pinnedAt: "2026-01-02T00:00:00.000Z",
          item: { id: "p1", name: "Acme relaunch", archivedAt: null },
        },
      ],
    };
    const user = userEvent.setup();
    renderPinned();

    await user.click(screen.getByRole("button", { name: /more/i }));

    expect(await screen.findByRole("menuitem", { name: "Unpin" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Archive" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Unarchive" })).toBeNull();
  });

  it("the kebab menu's Unpin item unpins the project", async () => {
    mockPins = {
      data: [
        {
          itemType: "project",
          itemId: "p1",
          pinnedAt: "2026-01-02T00:00:00.000Z",
          item: { id: "p1", name: "Acme relaunch", archivedAt: null },
        },
      ],
    };
    const user = userEvent.setup();
    renderPinned();

    await user.click(screen.getByRole("button", { name: /more/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Unpin" }));

    expect(unpinMutateMock).toHaveBeenCalledWith({
      itemType: "project",
      itemId: "p1",
    });
  });
});
