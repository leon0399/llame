import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import { AppearanceProvider } from "@/contexts/appearance-context";
// Import through the real specifier: sb.mock redirects it to its controllable
// mock, so the Memory card and this story use the same hook.
import * as memoryQueries from "@/lib/services/memory/queries";
import { refetchMemory } from "@/lib/services/memory/__mocks__/queries";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";
import SettingsPage from "./page";

// The page composes the Appearance card (real AppearanceProvider), the
// Personalization card (real queries against a stubbed fetch) and the Memory
// card (whose query the preview already mocks for its own stories). An
// unrouted request fails the story.
const ME_ROUTE = "GET /auth/v1/me";
const PERSONALIZATION_ROUTE = "GET /api/v1/me/personalization";

const useMemoryQuery = vi.mocked(memoryQueries.useMemoryQuery, {
  partial: true,
});

let fetchMock: Mock<typeof fetch>;

/** The "METHOD /path" a fetch call targets. */
function routeOf(input: RequestInfo | URL) {
  const request = input instanceof Request ? input : new Request(input);
  return `${request.method} ${new URL(request.url).pathname}`;
}

function routeFetch() {
  fetchMock = stubFetch();
  fetchMock.mockImplementation(async (input) => {
    const key = routeOf(input);
    if (key === ME_ROUTE) return new Response(null, { status: 401 });
    if (key === PERSONALIZATION_ROUTE) {
      return jsonResponse({
        preferredName: null,
        about: null,
        responsePreferences: null,
        enabled: true,
        shareAccountIdentity: false,
      });
    }
    throw new Error(`unrouted fetch in story: ${key}`);
  });
}

const meta = {
  component: SettingsPage,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  beforeEach: () => {
    routeFetch();
    useMemoryQuery.mockReturnValue({
      data: { shareRecentChats: false },
      isPending: false,
      isError: false,
      refetch: refetchMemory,
    });
    return () => {
      vi.unstubAllGlobals();
    };
  },
  render: () => (
    <AppearanceProvider>
      <SettingsPage />
    </AppearanceProvider>
  ),
} satisfies Meta<typeof SettingsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The theme picker's own trigger. Scoped to its row so its "System" label
 * isn't confused with the font switchers below it, which share that label as
 * their own default option. */
function themeTrigger(canvasElement: HTMLElement) {
  const label = within(canvasElement).getByText("Theme");
  // SAFETY: SettingRow always wraps the label paragraph and its trailing
  // control in one "flex items-center justify-between" row.
  const row = label.closest(
    ".flex.items-center.justify-between",
  ) as HTMLElement;
  return within(row).getByRole("button", { name: /System/ });
}

/**
 * The settings page under its heading, with all three cards: Appearance,
 * Personalization once its settings load, and Memory.
 *
 * @summary the page heading and its three settings cards
 */
export const Default: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      canvas.getByRole("heading", { name: "Settings", level: 2 }),
    ).toBeVisible();
    await expect(canvas.getByText("Appearance")).toBeVisible();
    await expect(
      await canvas.findByLabelText("What should the assistant call you?"),
    ).toBeVisible();
    await expect(canvas.getByText("Personalization")).toBeVisible();
    await expect(canvas.getByText("Memory")).toBeVisible();
    await expect(
      canvas.getByRole("switch", { name: "Share my recent chats" }),
    ).not.toBeChecked();
    // Every request the page sent, in order.
    await expect(fetchMock.mock.calls.map(([input]) => routeOf(input))).toEqual(
      [PERSONALIZATION_ROUTE, ME_ROUTE],
    );
  },
};

/**
 * Opening the theme picker lists Light, Dark and System, with System — the
 * default — checked.
 *
 * @summary the theme menu with the default theme checked
 */
export const ThemeMenu: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    await userEvent.click(themeTrigger(canvasElement));

    await expect(
      await screen.findByRole("menuitemradio", { name: "System" }),
    ).toBeChecked();
    await expect(
      screen.getAllByRole("menuitemradio").map((item) => item.textContent),
    ).toEqual(["Light", "Dark", "System"]);
    await expect(
      screen.getByRole("menuitemradio", { name: "Light" }),
    ).not.toBeChecked();
    await expect(
      screen.getByRole("menuitemradio", { name: "Dark" }),
    ).not.toBeChecked();
  },
};
