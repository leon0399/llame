import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor, within } from "storybook/test";

import { TooltipProvider } from "@workspace/ui/components/tooltip";

import { WorkspaceIndicator } from "./workspace-indicator";

const meta = {
  component: WorkspaceIndicator,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof WorkspaceIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The compact final-segment label shown for a bound Chat Workspace. */
export const Bound: Story = {
  tags: ["ai-generated"],
  args: { workspaceRoot: "/home/operator/projects/llame" },
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByLabelText(
      "Workspace: /home/operator/projects/llame",
    );

    await userEvent.hover(trigger);
    const tooltip = await waitFor(() => {
      const content = document.querySelector<HTMLElement>(
        "[data-slot='tooltip-content']",
      );
      expect(content).toBeVisible();
      return content;
    });
    await expect(tooltip).toHaveTextContent("/home/operator/projects/llame");
  },
};

/** An unbound Chat has no header indicator at all. */
export const Unbound: Story = {
  tags: ["ai-generated"],
  args: { workspaceRoot: null },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector('[aria-label^="Workspace:"]'),
    ).toBeNull();
  },
};

/** A long canonical root keeps only its final segment in the header. */
export const LongPath: Story = {
  tags: ["ai-generated"],
  args: {
    workspaceRoot:
      "/home/operator/projects/llame/packages/really-long-workspace-name",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("really-long-workspace-name")).toBeVisible();
  },
};
