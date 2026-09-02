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
 *
 * usePins, useUnpinItem, useSetChatArchive, and useSetProjectArchive all run
 * for real against a stubbed globalThis.fetch (GET /api/v1/pins, DELETE
 * /api/v1/pins/:itemType/:itemId) — an "Unpin" click is proved by the real
 * DELETE request it sends, not an echoed mock-call. Only next/navigation (no
 * in-process seam) is mocked.
 */

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

import { pinQueryKeys } from "@/lib/services/pins/queries";
import type { PinnedItem } from "@/lib/services/pins/types";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

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
});

let fetchMock: Mock<typeof fetch>;
// Left unresolved by default — GET /api/v1/pins stays pending until a test
// overrides this, mirroring usePins's real isPending state.
let pinsHandler: () => Promise<Response>;

function stubPinsNetwork() {
  fetchMock = stubFetch();
  pinsHandler = () => new Promise<Response>(() => {});
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v1/pins" && request.method === "GET") {
      return pinsHandler();
    }
    const pinMatch = /^\/api\/v1\/pins\/(chat|project)\/(.+)$/.exec(pathname);
    if (pinMatch && request.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (
      request.method === "PATCH" &&
      (/^\/api\/v1\/chats\/.+$/.exec(pathname) ||
        /^\/api\/v1\/projects\/.+$/.exec(pathname))
    ) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
}

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

/** AppSidebarPinned calls usePins() (needs only QueryClientProvider) before
 * touching any Sidebar context, so the empty/loading-state tests render
 * without SidebarProvider — same as the component's own render() call
 * before this conversion — to keep container.firstChild the component's
 * own (null) output, not a SidebarProvider wrapper div. */
function renderPinnedWithoutSidebar() {
  const queryClient = new QueryClient();
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AppSidebarPinned />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  stubPinsNetwork();
});

afterEach(() => {
  // NOT vi.unstubAllGlobals() — beforeAll's ResizeObserver/pointer-capture
  // stubs must survive across tests; beforeEach's stubFetch() already
  // replaces fetch fresh each test.
  cleanup();
});

/** Wait for and return the first stubbed-fetch Request sent with `method` to
 * a /api/v1/pins/... path. */
async function findPinRequest(method: string): Promise<Request> {
  const matches = (req: unknown): req is Request =>
    req instanceof Request &&
    req.method === method &&
    new URL(req.url).pathname.startsWith("/api/v1/pins/");
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([req]) => matches(req))).toBe(true),
  );
  return fetchMock.mock.calls.map(([req]) => req).find(matches)!;
}

describe("AppSidebarPinned", () => {
  it("renders nothing when there are no pins (no empty labelled group)", async () => {
    pinsHandler = () => Promise.resolve(jsonResponse<Array<PinnedItem>>([]));
    const { container, queryClient } = renderPinnedWithoutSidebar();

    await waitFor(() =>
      expect(queryClient.getQueryState(pinQueryKeys.list())?.status).toBe(
        "success",
      ),
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while pins are loading (data undefined)", () => {
    const { container } = renderPinnedWithoutSidebar();
    expect(container.firstChild).toBeNull();
  });

  it("renders a mixed chats+projects Pinned section in server (pin-recency) order", async () => {
    pinsHandler = () =>
      Promise.resolve(
        jsonResponse<Array<PinnedItem>>([
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
        ]),
      );

    renderPinned();

    expect(await screen.findByText("Pinned")).toBeTruthy();
    const rows = screen.getAllByRole("link");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Acme relaunch",
      "Trip to Lisbon",
    ]);
    expect(rows[0].getAttribute("href")).toBe("/projects/p1");
    expect(rows[1].getAttribute("href")).toBe("/chat/c1");
  });

  it("renders the localized placeholder for an untitled pinned chat", async () => {
    pinsHandler = () =>
      Promise.resolve(
        jsonResponse<Array<PinnedItem>>([
          {
            itemType: "chat",
            itemId: "c1",
            pinnedAt: "2026-01-01T00:00:00.000Z",
            item: { id: "c1", title: null, archivedAt: null },
          },
        ]),
      );

    renderPinned();

    expect(await screen.findByText("New chat")).toBeTruthy();
  });
});

describe("AppSidebarPinned — pinned chat row menu (mirrors ChatItem's row menu)", () => {
  it("the kebab menu exposes Unpin, Rename, Archive, and Delete — no chat-only data-heavy actions", async () => {
    pinsHandler = () =>
      Promise.resolve(
        jsonResponse<Array<PinnedItem>>([
          {
            itemType: "chat",
            itemId: "c1",
            pinnedAt: "2026-01-01T00:00:00.000Z",
            item: { id: "c1", title: "Trip to Lisbon", archivedAt: null },
          },
        ]),
      );
    const user = userEvent.setup();
    renderPinned();

    await user.click(await screen.findByRole("button", { name: /more/i }));

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
    pinsHandler = () =>
      Promise.resolve(
        jsonResponse<Array<PinnedItem>>([
          {
            itemType: "chat",
            itemId: "c1",
            pinnedAt: "2026-01-01T00:00:00.000Z",
            item: { id: "c1", title: "Trip to Lisbon", archivedAt: null },
          },
        ]),
      );
    const user = userEvent.setup();
    renderPinned();

    await user.click(await screen.findByRole("button", { name: /more/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Unpin" }));

    const request = await findPinRequest("DELETE");
    expect(new URL(request.url).pathname).toBe("/api/v1/pins/chat/c1");
  });

  it("the kebab menu's Archive item archives the chat", async () => {
    pinsHandler = () =>
      Promise.resolve(
        jsonResponse<Array<PinnedItem>>([
          {
            itemType: "chat",
            itemId: "c1",
            pinnedAt: "2026-01-01T00:00:00.000Z",
            item: { id: "c1", title: "Trip to Lisbon", archivedAt: null },
          },
        ]),
      );
    const user = userEvent.setup();
    renderPinned();

    await user.click(await screen.findByRole("button", { name: /more/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([req]) =>
            req instanceof Request &&
            req.method === "PATCH" &&
            new URL(req.url).pathname === "/api/v1/chats/c1",
        ),
      ).toBe(true),
    );
  });

  it("the kebab menu's Rename item opens the rename dialog", async () => {
    pinsHandler = () =>
      Promise.resolve(
        jsonResponse<Array<PinnedItem>>([
          {
            itemType: "chat",
            itemId: "c1",
            pinnedAt: "2026-01-01T00:00:00.000Z",
            item: { id: "c1", title: "Trip to Lisbon", archivedAt: null },
          },
        ]),
      );
    const user = userEvent.setup();
    renderPinned();

    await user.click(await screen.findByRole("button", { name: /more/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));

    expect(await screen.findByText("Rename chat")).toBeTruthy();
  });

  it("the kebab menu's Delete item opens the delete confirmation", async () => {
    pinsHandler = () =>
      Promise.resolve(
        jsonResponse<Array<PinnedItem>>([
          {
            itemType: "chat",
            itemId: "c1",
            pinnedAt: "2026-01-01T00:00:00.000Z",
            item: { id: "c1", title: "Trip to Lisbon", archivedAt: null },
          },
        ]),
      );
    const user = userEvent.setup();
    renderPinned();

    await user.click(await screen.findByRole("button", { name: /more/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(await screen.findByText("Delete chat?")).toBeTruthy();
  });
});

describe("AppSidebarPinned — pinned project row menu (mirrors ProjectItem's row menu)", () => {
  it("the kebab menu exposes Unpin, Rename, Archive, and Delete", async () => {
    pinsHandler = () =>
      Promise.resolve(
        jsonResponse<Array<PinnedItem>>([
          {
            itemType: "project",
            itemId: "p1",
            pinnedAt: "2026-01-02T00:00:00.000Z",
            item: { id: "p1", name: "Acme relaunch", archivedAt: null },
          },
        ]),
      );
    const user = userEvent.setup();
    renderPinned();

    await user.click(await screen.findByRole("button", { name: /more/i }));

    expect(await screen.findByRole("menuitem", { name: "Unpin" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Archive" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Unarchive" })).toBeNull();
  });

  it("the kebab menu's Unpin item unpins the project", async () => {
    pinsHandler = () =>
      Promise.resolve(
        jsonResponse<Array<PinnedItem>>([
          {
            itemType: "project",
            itemId: "p1",
            pinnedAt: "2026-01-02T00:00:00.000Z",
            item: { id: "p1", name: "Acme relaunch", archivedAt: null },
          },
        ]),
      );
    const user = userEvent.setup();
    renderPinned();

    await user.click(await screen.findByRole("button", { name: /more/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Unpin" }));

    const request = await findPinRequest("DELETE");
    expect(new URL(request.url).pathname).toBe("/api/v1/pins/project/p1");
  });

  it("the kebab menu's Archive item archives the project", async () => {
    pinsHandler = () =>
      Promise.resolve(
        jsonResponse<Array<PinnedItem>>([
          {
            itemType: "project",
            itemId: "p1",
            pinnedAt: "2026-01-02T00:00:00.000Z",
            item: { id: "p1", name: "Acme relaunch", archivedAt: null },
          },
        ]),
      );
    const user = userEvent.setup();
    renderPinned();

    await user.click(await screen.findByRole("button", { name: /more/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([req]) =>
            req instanceof Request &&
            req.method === "PATCH" &&
            new URL(req.url).pathname === "/api/v1/projects/p1",
        ),
      ).toBe(true),
    );
  });
});
