// @vitest-environment jsdom

/**
 * Covers admin-area-org-tree task 2.3: "soon"-chip parity on the
 * pre-existing disabled placeholders (Dashboard, Gallery, Calendar, Email,
 * Brain). The "Administration" entry is NOT one of these nav items — per
 * AppShell.dc.html it's its own bottom-pinned group, covered by
 * app-sidebar-admin-entry.test.tsx instead.
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

import { AppSidebarNav } from "./app-sidebar-nav";

beforeAll(() => {
  // jsdom doesn't implement the Pointer Events capture API Base UI's Tooltip
  // relies on for hover/focus handling.
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

function renderNav() {
  return render(
    <SidebarProvider>
      <AppSidebarNav />
    </SidebarProvider>,
  );
}

afterEach(() => {
  mockIsMobile = false;
  mockPathname = "/";
  cleanup();
});

describe("AppSidebarNav — soon-chip parity", () => {
  it("shows a visible 'soon' chip on every not-yet-built placeholder", () => {
    renderNav();
    for (const label of [
      "Dashboard",
      "Gallery",
      "Calendar",
      "Email",
      "Brain",
    ]) {
      const button = screen.getByText(label).closest("button");
      expect(button).toBeTruthy();
      expect(button?.getAttribute("aria-disabled")).toBe("true");
      expect(button?.textContent).toContain("soon");
    }
  });

  it("does not put a soon chip on real or desktop-only links", () => {
    renderNav();
    for (const label of ["Chats", "Projects"]) {
      const el = screen.getByText(label).closest("a, button");
      expect(el?.textContent).not.toContain("soon");
    }
  });

  it("does not render an Administration item among the main nav items", () => {
    renderNav();
    expect(screen.queryByText("Administration")).toBeNull();
  });
});
