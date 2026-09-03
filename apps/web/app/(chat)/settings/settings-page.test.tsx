// @vitest-environment jsdom

/**
 * Container coverage for SettingsPage: composes AppearanceSection (real
 * AppearanceProvider, already unit-tested in
 * contexts/appearance-context.test.tsx) with PersonalizationSection and
 * MemorySection (each already covered by their own test files) over a
 * stubbed globalThis.fetch. No first-party module mocking.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";
import { AppearanceProvider } from "@/contexts/appearance-context";

import SettingsPage from "./page";

function renderPage() {
  const fetchMock = stubFetch();
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/auth/v1/me") return new Response(null, { status: 401 });
    if (pathname === "/api/v1/me/personalization")
      return jsonResponse({
        preferredName: null,
        about: null,
        responsePreferences: null,
        enabled: true,
        shareAccountIdentity: false,
      });
    if (pathname === "/api/v1/me/memory")
      return jsonResponse({ shareRecentChats: false });
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider>
        <SettingsPage />
      </AppearanceProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/** The theme picker's own row — scoped so its "System"-labelled trigger
 * isn't confused with the font switchers below it, which share that label
 * as their own default option. */
function themeRow(): HTMLElement {
  const label = screen.getByText("Theme");
  // SAFETY: SettingRow always wraps the label paragraph and its trailing
  // control in one "flex items-center justify-between" row.
  return label.closest(".flex.items-center.justify-between") as HTMLElement;
}

describe("SettingsPage", () => {
  it("renders the page heading and all three settings cards", async () => {
    renderPage();

    expect(
      screen.getByRole("heading", { name: "Settings", level: 2 }),
    ).toBeTruthy();
    expect(screen.getByText("Appearance")).toBeTruthy();

    await waitFor(() =>
      expect(screen.getByText("Personalization")).toBeTruthy(),
    );
    expect(screen.getByText("Memory")).toBeTruthy();
  });

  it("opens the theme dropdown, listing all three options with System checked", async () => {
    renderPage();

    fireEvent.click(within(themeRow()).getByRole("button", { name: /System/ }));

    const systemOption = await screen.findByRole("menuitemradio", {
      name: "System",
    });
    expect(systemOption.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "Light" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toBeTruthy();
  });
});
