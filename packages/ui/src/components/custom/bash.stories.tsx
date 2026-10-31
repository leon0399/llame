import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { contrastKnownIssue232 } from "../known-a11y-issues.js";
import { BashTool } from "./bash.js";

/** The stored shape: the executor's own cut is `cut`, present only when set;
 *  `truncated` belongs to the runner's oversize cap. */
const success = {
  status: "success" as const,
  exitCode: 0,
  stdout: "apps/\npackages/\nREADME.md\n",
  stderr: "",
  wallTimeMs: 1240,
};

const meta = {
  component: BashTool,
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
    input: { command: "ls" },
    output: success,
    errorText: undefined,
    state: "output-available" as const,
  },
} satisfies Meta<typeof BashTool>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Use for a completed command: the command as a shell prompt, then its exit
 * code and standard output.
 *
 * @summary for a command that succeeded with output
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /bash/iu }));
    await expect(canvas.getByText("exit 0")).toBeInTheDocument();
    await expect(
      canvas.getByRole("group", { name: "Standard output" }),
    ).toHaveTextContent("README.md");
    await expect(
      canvas.queryByRole("group", { name: "Standard error" }),
    ).not.toBeInTheDocument();
    // The arguments already show as the prompt.
    await expect(canvas.queryByText("Parameters")).not.toBeInTheDocument();
  },
};

/**
 * A multi-line command keeps its lines; its working directory and added
 * environment sit under it.
 *
 * @summary for a command with a working directory and environment
 */
export const WorkingDirectoryAndEnvironment: Story = {
  tags: ["ai-generated"],
  args: {
    input: {
      command: "pnpm install\npnpm test",
      cwd: "/home/operator/repo",
      env: { CI: "1" },
    },
    output: { ...success, stdout: "", stderr: "warn: peer dependency\n" },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /bash/iu }));
    await expect(canvas.getByText("in /home/operator/repo")).toBeVisible();
    await expect(canvas.getByText("env CI=1")).toBeVisible();
    await expect(
      canvas.getByRole("group", { name: "Standard error" }),
    ).toHaveTextContent("warn: peer dependency");
  },
};

/**
 * A command that printed nothing says so instead of showing empty blocks.
 *
 * @summary for a command without output
 */
export const NoOutput: Story = {
  tags: ["ai-generated"],
  args: { input: { command: "true" }, output: { ...success, stdout: "" } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /bash/iu }));
    await expect(canvas.getByText("No output.")).toBeInTheDocument();
  },
};

/**
 * A settled command reports its wall time in the details row.
 *
 * @summary for a command with a reported wall time
 */
export const WallTime: Story = {
  tags: ["ai-generated"],
  args: { input: { command: "sleep 1.2" }, output: success },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /bash/iu }));
    await expect(canvas.getByText("Time:")).toBeVisible();
    await expect(canvas.getByText(/1\.2 s/u)).toBeVisible();
  },
};

/**
 * Output the executor cut at its stream bound says so in the details row.
 *
 * @summary for a command whose output was cut at the bound
 */
export const CutAtBound: Story = {
  tags: ["ai-generated"],
  args: {
    input: { command: "cat big.log" },
    output: { ...success, cut: true },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /bash/iu }));
    await expect(canvas.getByText("Truncated:")).toBeVisible();
    await expect(canvas.getByText("yes")).toBeVisible();
  },
};

/**
 * A failed command's output arrives inside the error text, which keeps its
 * line breaks.
 *
 * @summary for a command that exited non-zero
 */
export const Failed: Story = {
  tags: ["ai-generated"],
  // #232: the destructive error panel's token pairing fails color-contrast.
  parameters: contrastKnownIssue232,
  args: {
    input: { command: "pnpm test" },
    output: undefined,
    errorText: "exit 1, 2.4 s\n1 failed\n[stderr]\nAssertionError",
    state: "output-error" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /bash/iu }));
    const error = canvas.getByRole("group", { name: "Error" });
    await expect(error).toHaveTextContent("exit 1, 2.4 s");
    await expect(error).toHaveTextContent("[stderr]");
    await expect(within(error).getByText(/AssertionError/u)).toBeVisible();
    await expect(
      canvas.getByText("pnpm test", { selector: "p" }),
    ).toBeVisible();
  },
};

/**
 * While the command runs, the prompt shows with a pending line.
 *
 * @summary for a command that has not settled
 */
export const Running: Story = {
  tags: ["ai-generated"],
  args: { output: undefined, state: "input-available" as const },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /bash/iu }));
    await expect(canvas.getByText("Running…")).toBeInTheDocument();
  },
};

/**
 * A user stop shows only the neutral badge, never the transport error.
 *
 * @summary for a command cancelled by the user
 */
export const Cancelled: Story = {
  tags: ["ai-generated"],
  args: {
    output: undefined,
    errorText: "The run was cancelled before this tool finished.",
    state: "cancelled" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /bash/iu }));
    await expect(canvas.getByText("Cancelled")).toBeInTheDocument();
    await expect(
      canvas.queryByText("The run was cancelled before this tool finished."),
    ).not.toBeInTheDocument();
  },
};
