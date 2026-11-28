import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import { AppearanceProvider } from "@/contexts/appearance-context";
import {
  FONT_STYLE_COOKIE,
  MONO_FONT_STYLE_COOKIE,
} from "@/lib/appearance/font/consts";
import { stubFetch } from "@/lib/test-support/fetch-stub";
import AppearanceSettingsPage from "./page";

// The Appearance page reads nothing from the API: the theme lives in
// next-themes and the fonts in cookies. Any request fails the story.
let fetchMock: Mock<typeof fetch>;

/** Drops a font cookie so each story starts from the default. */
function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0`;
}

function cookieValue(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

const meta = {
  component: AppearanceSettingsPage,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  beforeEach: () => {
    fetchMock = stubFetch();
    fetchMock.mockImplementation(async (input) => {
      throw new Error(`unexpected fetch in story: ${String(input)}`);
    });
    clearCookie(FONT_STYLE_COOKIE);
    clearCookie(MONO_FONT_STYLE_COOKIE);

    return () => {
      vi.unstubAllGlobals();
      clearCookie(FONT_STYLE_COOKIE);
      clearCookie(MONO_FONT_STYLE_COOKIE);
      document.documentElement.style.removeProperty("--font-sans");
      document.documentElement.style.removeProperty("--font-mono");
    };
  },
  render: () => (
    <AppearanceProvider>
      <AppearanceSettingsPage />
    </AppearanceProvider>
  ),
} satisfies Meta<typeof AppearanceSettingsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The control at the end of a setting's label line (`SettingField`). */
function fieldControl(canvasElement: HTMLElement, label: string) {
  const field = within(canvasElement)
    .getByText(label)
    .closest<HTMLElement>('[data-slot="field"]');

  if (field === null) throw new Error(`no field labelled ${label}`);

  return within(field).getByRole("button");
}

/**
 * The page names its section and lists its three settings, each a label
 * with its description and a compact picker on the label's line; it sends
 * no request.
 *
 * @summary the Appearance section with its three settings
 */
export const Default: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      canvas.getByRole("heading", { name: "Appearance", level: 1 }),
    ).toBeVisible();

    for (const label of ["Theme", "Interface font", "Code font"]) {
      await expect(canvas.getByText(label)).toBeVisible();
      await expect(fieldControl(canvasElement, label)).toBeVisible();
    }

    await expect(fetchMock).not.toHaveBeenCalled();
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
    await userEvent.click(fieldControl(canvasElement, "Theme"));

    await expect(
      await screen.findByRole("menuitemradio", { name: "System" }),
    ).toBeChecked();
    await expect(
      screen.getAllByRole("menuitemradio").map((item) => item.textContent),
    ).toEqual(["Light", "Dark", "System"]);
  },
};

/**
 * Choosing an interface or code font stores it in its cookie, applies it to
 * the page's font variable, and names it on the picker. Base UI hands the
 * picker's change handler its event details too; passing them on to the
 * cookie setter used to throw before anything was stored.
 *
 * @summary a chosen font is stored and applied
 */
export const ChoosingAFontAppliesIt: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const root = document.documentElement;

    await userEvent.click(fieldControl(canvasElement, "Interface font"));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: /Open Dyslexic/ }),
    );

    await waitFor(() =>
      expect(cookieValue(FONT_STYLE_COOKIE)).toBe("open-dyslexic"),
    );
    await expect(root.style.getPropertyValue("--font-sans")).toBe(
      "var(--font-open-dyslexic)",
    );
    await expect(
      fieldControl(canvasElement, "Interface font"),
    ).toHaveTextContent("Open Dyslexic");

    await userEvent.click(fieldControl(canvasElement, "Code font"));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: /Fira Code/ }),
    );

    await waitFor(() =>
      expect(cookieValue(MONO_FONT_STYLE_COOKIE)).toBe("fira-code"),
    );
    await expect(root.style.getPropertyValue("--font-mono")).toBe(
      "var(--font-fira-code)",
    );
  },
};
