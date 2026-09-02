/**
 * AdminLayout is an async Server Component (a plain async function, same as
 * app/(chat)/chat/[id]/page.tsx) — call it directly and inspect the returned
 * element tree structurally, the pattern that file's own test established.
 * No DOM render: SidebarProvider/AppSidebar/AdminSectionNav/AdminHeader all
 * need client-only context this layer doesn't own proving.
 *
 * next/headers is the external boundary (permitted mock target) — cookies()/
 * headers() have no in-process seam otherwise.
 */

import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, headersMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(async () => ({
    get: (_name: string): { value: string } | undefined => undefined,
  })),
  headersMock: vi.fn(async () => ({
    get: (_name: string): string | null => null,
  })),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock, headers: headersMock }));

import AdminLayout from "./layout";
import { SidebarProvider } from "@/app/shell/app-sidebar";
import { AdminSectionNav } from "./components/admin-section-nav";

function childrenOf(element: ReactNode): ReadonlyArray<ReactNode> {
  if (!isValidElement<{ children: ReactNode }>(element)) {
    throw new Error("expected an element");
  }
  const kids = element.props.children;
  return Array.isArray(kids) ? kids : [kids];
}

beforeEach(() => {
  cookiesMock.mockReset();
  cookiesMock.mockResolvedValue({ get: () => undefined });
  headersMock.mockReset();
  headersMock.mockResolvedValue({ get: () => null });
});

describe("AdminLayout", () => {
  it("defaults the sidebar collapsed when no cookie is stored", async () => {
    const element = await AdminLayout({ children: "content" });

    expect(isValidElement<{ defaultOpen: boolean }>(element)).toBe(true);
    if (!isValidElement<{ defaultOpen: boolean }>(element)) return;
    expect(element.type).toBe(SidebarProvider);
    expect(element.props.defaultOpen).toBe(false);
  });

  it("expands the sidebar when the cookie says so", async () => {
    cookiesMock.mockResolvedValue({
      get: (name: string) =>
        name === "sidebar_state" ? { value: "true" } : undefined,
    });

    const element = await AdminLayout({ children: "content" });
    if (!isValidElement<{ defaultOpen: boolean }>(element)) {
      throw new Error("expected SidebarProvider element");
    }
    expect(element.props.defaultOpen).toBe(true);
  });

  it("passes the request's Host header to AdminSectionNav, falling back to 'instance'", async () => {
    headersMock.mockResolvedValue({
      get: (name: string) => (name === "host" ? "admin.example.com" : null),
    });

    const element = await AdminLayout({ children: "content" });
    const [, nav] = childrenOf(element);
    if (!isValidElement<{ host: string }>(nav)) {
      throw new Error("expected AdminSectionNav element");
    }
    expect(nav.type).toBe(AdminSectionNav);
    expect(nav.props.host).toBe("admin.example.com");
  });

  it("falls back to 'instance' when the host header is absent", async () => {
    const element = await AdminLayout({ children: "content" });
    const [, nav] = childrenOf(element);
    if (!isValidElement<{ host: string }>(nav)) {
      throw new Error("expected AdminSectionNav element");
    }
    expect(nav.props.host).toBe("instance");
  });
});
