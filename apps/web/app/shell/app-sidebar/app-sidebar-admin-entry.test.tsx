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

vi.mock("@workspace/ui/hooks/use-mobile", () => ({
  useIsMobile: () => true,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { AppSidebarAdminEntry } from "./app-sidebar-admin-entry";

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
