import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { ToolCapNoticePart } from "./tool-cap-notice-part";

const meta = {
  component: ToolCapNoticePart,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof ToolCapNoticePart>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The step-cap chip a run leaves behind when it hit `tools.maxStepsPerRun`
 * and was forced to answer from accumulated context (tool-calling-loop D6) —
 * visible in the transcript so the cap is never silent.
 *
 * @summary tool step-limit chip naming steps used and the cap
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  args: { stepsUsed: 8, maxSteps: 8 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/8\/8/)).toBeVisible();
    await expect(canvas.getByText(/Tool step limit reached/)).toBeVisible();
  },
};
