// @vitest-environment jsdom

/**
 * Covers admin-area-org-tree task 2.1: the admin second rail's section
 * list — Organizations is the only live/active link, the other five
 * (Users & accounts, Model providers, Connectors, Policies, Audit log)
 * render as disabled (not hidden) placeholders with a visible "soon" chip.
 */

import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SidebarProvider } from "@workspace/ui/components/sidebar";

vi.mock("@workspace/ui/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

let mockPathname = "/admin/organizations";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import { AdminSectionNav } from "./admin-section-nav";

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

function renderNav() {
  return render(
    <SidebarProvider>
      <AdminSectionNav host="llame.local" />
    </SidebarProvider>,
  );
}

afterEach(() => {
  mockPathname = "/admin/organizations";
  cleanup();
});

describe("AdminSectionNav", () => {
  it("renders Organizations as the active, live link", () => {
    renderNav();
    const link = screen.getByRole("link", { name: /Organizations/i });
    expect(link.getAttribute("href")).toBe("/admin/organizations");
    // asChild renders the Link straight through Slot — data-active lands on
    // the <a> itself, there is no separate wrapping <button>.
    expect(link.getAttribute("data-active")).toBe("true");
  });

  it("renders the five stub sections as disabled placeholders with a soon chip, not links", () => {
    renderNav();
    for (const label of [
      "Users & accounts",
      "Model providers",
      "Connectors",
      "Policies",
      "Audit log",
    ]) {
      const button = screen.getByText(label).closest("button");
      expect(button).toBeTruthy();
      expect(button?.getAttribute("aria-disabled")).toBe("true");
      expect(button?.getAttribute("tabindex")).toBe("-1");
      expect(button?.textContent).toContain("soon");
    }
    expect(
      screen.queryByRole("link", { name: /Users & accounts/i }),
    ).toBeNull();
  });

  it("shows the instance host in the footer", () => {
    renderNav();
    expect(screen.getByText(/instance · llame\.local/)).toBeTruthy();
  });
});
