import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";

import { WaitTool } from "./wait.js";

const meta = {
  component: WaitTool,
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
    input: { jobs: ["job://bash-4"], timeout: 30 },
    output: {
      status: "success",
      ended: "settled",
      jobs: [
        {
          locator: "job://bash-4",
          state: "succeeded",
          elapsedMs: 1250,
          exitDetail: { exitCode: 0 },
          outputs: [{ name: "stdout", text: "tests passed\n" }],
          artifactLocator: "artifact://bash-4",
        },
      ],
    },
    errorText: undefined,
    state: "output-available" as const,
  },
} satisfies Meta<typeof WaitTool>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A settled wait includes only its returned job state and output excerpt. */
export const Settled: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /wait/iu }));
    await expect(canvas.getByText("settled")).toBeVisible();
    await expect(canvas.getByText("tests passed")).toBeVisible();
    await expect(canvas.getByText("artifact://bash-4")).toBeVisible();
  },
};

/** A timed-out wait can return a still-running job without output. */
export const TimedOut: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      status: "success",
      ended: "timeout",
      jobs: [{ locator: "job://bash-4", state: "running" }],
      promise: "The jobs continue in the background.",
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /wait/iu }));
    await expect(canvas.getByText("timeout")).toBeVisible();
    await expect(canvas.getByText("running")).toBeVisible();
    await expect(
      canvas.getByText("The jobs continue in the background."),
    ).toBeVisible();
  },
};

/** Unknown historical output remains visible through the generic fallback. */
export const UnknownOutput: Story = {
  tags: ["ai-generated"],
  args: { output: { status: "success", ended: "later", jobs: [] } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /wait/iu }));
    await waitFor(() =>
      expect(canvas.getByRole("group", { name: "Result" })).toHaveTextContent(
        /later/u,
      ),
    );
  },
};

/** An interrupted wait reports its actual end reason and current job state. */
export const Interrupted: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      status: "success",
      ended: "interrupted",
      jobs: [{ locator: "job://bash-4", state: "running" }],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /wait/iu }));
    await expect(canvas.getByText("interrupted")).toBeVisible();
    await expect(canvas.getByText("running")).toBeVisible();
  },
};
