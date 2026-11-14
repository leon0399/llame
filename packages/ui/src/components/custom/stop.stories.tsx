import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";

import { StopTool } from "./stop.js";

const meta = {
  component: StopTool,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[36rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    input: { jobs: ["job://bash-4"] },
    output: {
      status: "success",
      jobs: [
        { job: "job://bash-4", state: "cancelled", stopped_by: "assistant" },
      ],
    },
    errorText: undefined,
    state: "output-available" as const,
  },
} satisfies Meta<typeof StopTool>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * A stop result reports the settled state and any recorded stop owner.
 *
 * @summary stopped job state and recorded stop owner
 */
export const Stopped: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /stop/iu }));
    await expect(canvas.getByText("cancelled")).toBeVisible();
    await expect(canvas.getByText("assistant")).toBeVisible();
  },
};

/**
 * Unknown or error result shapes remain available through the fallback.
 *
 * @summary unknown stop output uses the generic fallback
 */
export const UnknownOutput: Story = {
  tags: ["ai-generated"],
  args: { output: { status: "success", jobs: [{ locator: "job://bash-4" }] } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /stop/iu }));
    await waitFor(() =>
      expect(canvas.getByRole("group", { name: "Result" })).toHaveTextContent(
        /"locator"/u,
      ),
    );
  },
};

/**
 * A stop can return before settlement and report that a job is still running.
 *
 * @summary stop returns while the job is still running
 */
export const StillRunning: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      status: "success",
      jobs: [{ job: "job://bash-4", state: "running" }],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /stop/iu }));
    await expect(canvas.getByText("running")).toBeVisible();
    await expect(canvas.queryByText("Stopped by:")).not.toBeInTheDocument();
  },
};
