// @vitest-environment jsdom

/**
 * Covers admin-area-org-tree task 2.2 (corrected placement — AppShell.dc.html):
 * Administration renders in its OWN group, positioned after the scrollable
 * nav content and before the user-profile footer — NOT among the main nav
 * items, and NOT present in the user/profile dropdown menu at all.
 *
 * useIsMobile and useMe run for real: the mobile hook reads window.matchMedia
 * /innerWidth (same technique as app-sidebar-admin-entry.test.tsx — replacing
 * it would only prove a stub returned false), and useMe hits a stubbed
 * globalThis.fetch (GET /auth/v1/me). usePins/usePinItem/useUnpinItem are NOT
 * mocked here — AppSidebar's own tree never calls them, only
 * AppSidebarPinned's does, and that subtree stays stubbed (see its own
 * comment below) so those two service modules are simply never imported.
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
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { PublicUserResponse } from "@/lib/services/auth/queries";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// AppSidebar statically imports AppSidebarPinned, which pulls framer-motion's
// Reorder DnD. Vitest still transforms the real module under `vi.mock`, and
// that graph ON TOP OF AppSidebar's own full shell graph OOMs this worker
// (~4–8GB, previously measured) — a real AppSidebarPinned alone is fine (see
// app-sidebar-pinned.test.tsx, which renders it for real), it's the
// COMBINATION with the rest of this suite's shell that doesn't fit. Kept
// mocked deliberately; this suite only asserts Administration placement in
// the chrome, which doesn't depend on the pinned rail's content.
// eslint-disable-next-line anti-slop/no-module-mocking -- measured OOM, see above
vi.mock("./app-sidebar-pinned", () => ({
  AppSidebarPinned: () => null,
}));

// Defense in depth: if anything else in the shell graph grows a framer-motion
// import, keep the heavy package out of this worker.
vi.mock("framer-motion", () => {
  function Passthrough({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) {
    return <div {...props}>{children}</div>;
  }
  return {
    Reorder: { Group: Passthrough, Item: Passthrough },
    useDragControls: () => ({ start: () => undefined }),
  };
});

import { AppSidebar, SidebarProvider } from "./index";

// The real useIsMobile runs: it reads window.matchMedia and
// window.innerWidth, both of which jsdom lets us drive directly.
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({
      matches: width < 768,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    configurable: true,
  });
}

beforeAll(() => {
  setViewportWidth(1024);
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

const ME: PublicUserResponse = {
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  emailVerified: null,
  image: null,
};

beforeEach(() => {
  stubFetch().mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/auth/v1/me") return jsonResponse<PublicUserResponse>(ME);
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
});

function renderShell() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  // NOT vi.unstubAllGlobals() — beforeAll's pointer-capture/scrollIntoView
  // stubs must survive across tests; beforeEach's stubFetch() already
  // replaces fetch fresh each test.
  cleanup();
});

describe("AppSidebar — Administration placement (bottom-pinned group)", () => {
  it("positions Administration after the scrollable nav content and before the user footer", async () => {
    renderShell();

    const brainItem = screen.getByText("Brain");
    const adminLink = screen.getByRole("link", { name: /Administration/i });
    const userEmail = await screen.findByText("ada@example.com");

    // Administration follows the last main nav item...
    expect(
      brainItem.compareDocumentPosition(adminLink) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // ...and precedes the user-profile footer.
    expect(
      adminLink.compareDocumentPosition(userEmail) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is not one of the main nav items", () => {
    renderShell();
    // Exactly one "Administration" text node — its own group, not duplicated
    // into the main nav list.
    expect(screen.getAllByText("Administration")).toHaveLength(1);
  });

  it("does not appear in the user/profile dropdown menu", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByText("ada@example.com"));

    expect(
      await screen.findByRole("menuitem", { name: "Settings" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: /Administration/i }),
    ).toBeNull();
  });
});
