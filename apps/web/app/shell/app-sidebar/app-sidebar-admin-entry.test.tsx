// @vitest-environment jsdom

/**
 * Covers admin-area-org-tree task 2.2 (corrected placement — AppShell.dc.html):
 * Administration is its OWN bottom-pinned group, not a main nav item and not
 * in the user menu. Desktop-only, disabled-not-hidden with a tooltip on
 * mobile (same convention as AppSidebarNav's other desktop-only items).
 */

import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SidebarProvider } from "@workspace/ui/components/sidebar";

let mockIsMobile = false;
vi.mock("@workspace/ui/hooks/use-mobile", () => ({
  useIsMobile: () => mockIsMobile,
}));

let mockPathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import { AppSidebarAdminEntry } from "./app-sidebar-admin-entry";

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
});

function renderEntry() {
  return render(
    <SidebarProvider>
      <AppSidebarAdminEntry />
    </SidebarProvider>,
  );
}

afterEach(() => {
  mockIsMobile = false;
  mockPathname = "/";
  cleanup();
});

describe("AppSidebarAdminEntry", () => {
  it("renders as a live link to /admin/organizations on desktop", () => {
    renderEntry();
    const link = screen.getByRole("link", { name: /Administration/i });
    expect(link.getAttribute("href")).toBe("/admin/organizations");
  });

  it("marks itself active when the route is under /admin", () => {
    mockPathname = "/admin/organizations";
    renderEntry();
    const link = screen.getByRole("link", { name: /Administration/i });
    // asChild renders the Link straight through Slot — data-active lands on
    // the <a> itself, there is no separate wrapping <button>.
    expect(link.getAttribute("data-active")).toBe("true");
  });

  it("renders disabled (not hidden) with a tooltip on mobile instead of linking", () => {
    mockIsMobile = true;
    renderEntry();
    expect(screen.queryByRole("link", { name: /Administration/i })).toBeNull();
    const button = screen.getByText("Administration").closest("button");
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.getAttribute("tabindex")).toBe("-1");
  });
});
