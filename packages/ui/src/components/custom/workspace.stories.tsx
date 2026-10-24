import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { contrastKnownIssue232 } from "../known-a11y-issues.js";
import { WorkspaceTool } from "./workspace.js";

const authority =
  "Workspace selects a working root but is not filesystem confinement; host operations retain the host user's authority.";

const entered = {
  status: "success" as const,
  root: "/home/operator/repo",
  state: "bound" as const,
  authority,
  skills: [{ name: "release", description: "Cut a release." }],
  skillsOmitted: 2,
  mcpServers: [
    { id: "docs", state: "available" as const },
    {
      id: "tracker",
      state: "unavailable" as const,
      reason: "available from the next Run",
    },
  ],
};

const meta = {
  component: WorkspaceTool,
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
    name: "enter_workspace",
    input: { path: "/home/operator/repo" },
    output: entered,
    errorText: undefined,
    state: "output-available" as const,
  },
  argTypes: { name: { control: false } },
} satisfies Meta<typeof WorkspaceTool>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Use for entering a Workspace: the root, the transition, its skills and MCP
 * servers, and the authority disclosure.
 *
 * @summary for a Run that entered a Workspace
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /enter_workspace/iu }),
    );
    await expect(canvas.getByText("Entered")).toBeInTheDocument();
    await expect(canvas.getByText(authority)).toBeInTheDocument();
    await expect(canvas.getByText("+2 more")).toBeInTheDocument();
    await expect(
      canvas.getByText(/unavailable, available from the next Run/u),
    ).toBeInTheDocument();
  },
};

/**
 * Entering another root while one is entered switches to it.
 *
 * @summary for a Run that switched Workspaces
 */
export const Switched: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      ...entered,
      state: "switched" as const,
      skills: [],
      skillsOmitted: 0,
      mcpServers: [],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /enter_workspace/iu }),
    );
    await expect(canvas.getByText("Switched to")).toBeInTheDocument();
    await expect(canvas.queryByText("Skills")).not.toBeInTheDocument();
  },
};

/**
 * Leaving a Workspace names the root that was left.
 *
 * @summary for a Run that left its Workspace
 */
export const Exited: Story = {
  tags: ["ai-generated"],
  args: {
    name: "exit_workspace",
    input: {},
    output: {
      status: "success" as const,
      root: null,
      state: "exited" as const,
      previousRoot: "/home/operator/repo",
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /exit_workspace/iu }),
    );
    await expect(canvas.getByText("Left")).toBeInTheDocument();
  },
};

/**
 * Leaving when no Workspace was entered says so.
 *
 * @summary for an exit without an entered Workspace
 */
export const ExitedUnbound: Story = {
  tags: ["ai-generated"],
  args: {
    name: "exit_workspace",
    input: {},
    output: {
      status: "success" as const,
      root: null,
      state: "unbound" as const,
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /exit_workspace/iu }),
    );
    await expect(canvas.getByText("No Workspace was entered.")).toBeVisible();
  },
};

/**
 * A missing directory fails the transition.
 *
 * @summary for a Workspace path that does not exist
 */
export const Failed: Story = {
  tags: ["ai-generated"],
  // #232: the destructive error panel's token pairing fails color-contrast.
  parameters: contrastKnownIssue232,
  args: {
    output: undefined,
    errorText: "The Workspace directory was not found.",
    state: "output-error" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /enter_workspace/iu }),
    );
    await expect(
      canvas.getByText("The Workspace directory was not found."),
    ).toBeVisible();
  },
};
