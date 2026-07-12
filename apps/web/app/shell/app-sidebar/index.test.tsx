// @vitest-environment jsdom

/**
 * Covers admin-area-org-tree task 2.2 (corrected placement — AppShell.dc.html):
 * Administration renders in its OWN group, positioned after the scrollable
 * nav content and before the user-profile footer — NOT among the main nav
 * items, and NOT present in the user/profile dropdown menu at all.
 */

import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@workspace/ui/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@/lib/services/auth/queries", () => ({
  useMe: () => ({
    data: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
  }),
  logout: vi.fn(),
}));

import { AppSidebar, SidebarProvider } from "./index";

beforeAll(() => {
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

function renderShell() {
  return render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("AppSidebar — Administration placement (bottom-pinned group)", () => {
  it("positions Administration after the scrollable nav content and before the user footer", () => {
    renderShell();

    const brainItem = screen.getByText("Brain");
    const adminLink = screen.getByRole("link", { name: /Administration/i });
    const userEmail = screen.getByText("ada@example.com");

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

    await user.click(screen.getByText("ada@example.com"));

    expect(
      await screen.findByRole("menuitem", { name: "Settings" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: /Administration/i }),
    ).toBeNull();
  });
});
