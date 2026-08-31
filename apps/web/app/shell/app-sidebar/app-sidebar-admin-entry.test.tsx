// @vitest-environment jsdom

/**
 * Mobile-only branch of AppSidebarAdminEntry (admin-area-org-tree task 2.2):
 * desktop behavior lives in app-sidebar-admin-entry.stories.tsx (docs/testing.md
 * rule 5); this stays jsdom because vitest browser mode runs a fixed desktop
 * viewport, so the real useIsMobile media query can't be driven there.
 */

import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SidebarProvider } from "@workspace/ui/components/sidebar";

// The real useIsMobile runs: it reads window.matchMedia and
// window.innerWidth, both of which jsdom lets us drive directly. Replacing
// the hook would have proved only that a stub returned true.
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

// next/navigation is an external package and a legitimate test boundary;
// there is no in-process seam for the App Router's pathname.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { AppSidebarAdminEntry } from "./app-sidebar-admin-entry";

beforeAll(() => {
  setViewportWidth(500);
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

afterEach(() => {
  cleanup();
});

describe("AppSidebarAdminEntry (mobile)", () => {
  it("renders disabled (not hidden) with a tooltip on mobile instead of linking", () => {
    render(
      <SidebarProvider>
        <AppSidebarAdminEntry />
      </SidebarProvider>,
    );
    expect(screen.queryByRole("link", { name: /Administration/i })).toBeNull();
    const button = screen.getByText("Administration").closest("button");
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.getAttribute("tabindex")).toBe("-1");
  });
});
