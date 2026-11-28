import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { expect, within } from "storybook/test";

import { SectionPage } from "@/app/shell/section-rail";

import { SettingsHeader, SettingsRail } from "./settings-chrome";

/** The Settings area around one section page: its section rail, the
 *  breadcrumb header, and the page frame, as the area's layout composes them
 *  (without the main rail, which has its own stories). */
function SettingsArea() {
  return (
    <SidebarProvider className="min-h-0">
      <SettingsRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <SettingsHeader />
        <SectionPage
          title="Appearance"
          description="Theme and fonts, for this browser."
        >
          <p>Section content.</p>
        </SectionPage>
      </div>
    </SidebarProvider>
  );
}

const meta = {
  component: SettingsArea,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/settings/appearance" },
    },
  },
} satisfies Meta<typeof SettingsArea>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The rail groups the sections by what they govern, marks the open one, and
 * lists unbuilt ones as "soon"; the breadcrumb reads "Settings › Appearance"
 * with the section as the current page, in regular weight; the page carries
 * the section's heading.
 *
 * @summary the Settings rail, breadcrumb and page frame on desktop
 */
export const Desktop: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    for (const group of ["Account", "Preferences", "Assistant", "Workspace"]) {
      await expect(canvas.getByText(group)).toBeVisible();
    }

    const appearance = canvas.getByRole("link", { name: "Appearance" });

    await expect(appearance).toHaveAttribute("href", "/settings/appearance");
    await expect(appearance).toHaveAttribute("data-active");
    await expect(
      canvas.getByRole("link", { name: "Account & security" }),
    ).not.toHaveAttribute("data-active");
    // Keyboard shortcuts is not built on this layer: a disabled "soon" row
    // (aria-disabled, so it stays focusable and its tooltip reachable).
    await expect(
      canvas.getByText("Keyboard shortcuts").closest("button"),
    ).toHaveAttribute("aria-disabled", "true");

    const trail = canvas.getByRole("navigation", { name: "breadcrumb" });

    // The phone's section picker in the same trail also names the section;
    // CSS hides it at this width.
    const current = within(trail).getByText("Appearance", {
      selector: '[data-slot="breadcrumb-page"]',
    });

    await expect(within(trail).getByText("Settings")).toBeVisible();
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(getComputedStyle(current).fontWeight).toBe("400");

    await expect(
      canvas.getByRole("heading", { name: "Appearance", level: 1 }),
    ).toBeVisible();
  },
};
