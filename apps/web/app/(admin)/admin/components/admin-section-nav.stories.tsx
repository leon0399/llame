import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { expect, within } from "storybook/test";

import { AdminSectionNav } from "./admin-section-nav";

const meta = {
  component: AdminSectionNav,
  tags: ["autodocs"],
  args: { host: "llame.local" },
  parameters: {
    layout: "centered",
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/admin/organizations" },
    },
  },
  decorators: [
    (Story) => (
      <SidebarProvider className="min-h-0 w-fit">
        <div className="w-[16rem]">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
} satisfies Meta<typeof AdminSectionNav>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The admin area's second rail (admin-area-org-tree task 2.1): Organizations
 * is the only live section, marked active from the current pathname; the five
 * unshipped sections stay visible as disabled placeholders with a "soon" chip
 * (llame's unimplemented-UI convention: disabled, never hidden), and the
 * footer names the instance host.
 *
 * @summary admin rail with one live section and disabled placeholders
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const link = canvas.getByRole("link", { name: /Organizations/i });
    await expect(link).toHaveAttribute("href", "/admin/organizations");
    // asChild renders the Link straight through Slot — data-active lands on
    // the <a> itself, there is no separate wrapping <button>.
    await expect(link).toHaveAttribute("data-active");

    for (const label of [
      "Users & accounts",
      "Model providers",
      "Connectors",
      "Policies",
      "Audit log",
    ]) {
      const button = canvas.getByText(label).closest("button");
      await expect(button).toHaveAttribute("aria-disabled", "true");
      await expect(button).toHaveAttribute("tabindex", "-1");
      await expect(button?.textContent).toContain("soon");
    }
    await expect(
      canvas.queryByRole("link", { name: /Users & accounts/i }),
    ).not.toBeInTheDocument();

    await expect(canvas.getByText(/instance · llame\.local/)).toBeVisible();
  },
};
