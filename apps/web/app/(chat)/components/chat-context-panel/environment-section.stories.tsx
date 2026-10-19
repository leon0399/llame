import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, waitFor } from "storybook/test";

import { EnvironmentSection } from "./environment-section";

const DEVBOX_ROOT = "machine://devbox/home/box/work/shop";

const onlineDevbox = {
  name: "devbox",
  status: "online" as const,
  lastSeenAt: new Date(Date.now() - 30_000).toISOString(),
  failureReason: null,
  hubProtocolVersion: 1,
  daemonProtocolVersion: 1,
  daemonVersion: "0.0.1",
  roots: ["/home/box/work"],
};

const meta = {
  component: EnvironmentSection,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-64">
        <Story />
      </div>
    ),
  ],
  args: {
    workspaceRoot: DEVBOX_ROOT,
    machineName: "devbox",
    machine: onlineDevbox,
    project: { id: "11111111-1111-4111-8111-111111111111", name: "llame" },
  },
} satisfies Meta<typeof EnvironmentSection>;

export default meta;
type Story = StoryObj<typeof meta>;

// Reading the real clipboard back needs a permission grant the headless
// runner does not give, so the copy story swaps in a writeText spy.
const writeText = fn<(text: string) => Promise<void>>();
/**
 * A Chat in a Project, entered into a Workspace on an online Machine. The full
 * canonical root is shown and copied verbatim.
 *
 * @summary Machine Workspace, online, in a Project
 */
export const MachineOnline: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    writeText.mockReset().mockResolvedValue(undefined);
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    return () => {
      if (original) {
        Object.defineProperty(navigator, "clipboard", original);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    };
  },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole("link", { name: "llame" })).toHaveAttribute(
      "href",
      "/projects/11111111-1111-4111-8111-111111111111",
    );
    await expect(canvas.getByText(/^Online · seen/)).toBeVisible();
    await expect(canvas.getByText("Path on devbox")).toBeVisible();
    await expect(canvas.getByText("/home/box/work/shop")).toBeVisible();
    await expect(canvas.getByText(DEVBOX_ROOT)).toBeVisible();

    // The Machine-local path, for a terminal on the box.
    await userEvent.click(
      canvas.getByRole("button", { name: "Copy Workspace path" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("/home/box/work/shop"),
    );
    // The canonical locator, for a prompt.
    await userEvent.click(
      canvas.getByRole("button", { name: "Copy Workspace locator" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(DEVBOX_ROOT));
  },
};

/** An offline Machine keeps the binding; the reason is spelled out. */
export const MachineOffline: Story = {
  tags: ["ai-generated"],
  args: {
    machine: {
      ...onlineDevbox,
      status: "offline",
      failureReason: "host_key_mismatch",
    },
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("Offline · host key does not match"),
    ).toBeVisible();
    await expect(canvas.getByText(DEVBOX_ROOT)).toBeVisible();
  },
};

/** A Machine the operator removed: named, with no state claimed. */
export const MachineUnknown: Story = {
  tags: ["ai-generated"],
  args: { machine: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Status unknown")).toBeVisible();
  },
};

/** A local Workspace runs on this host and has one path, no locator. */
export const LocalWorkspace: Story = {
  tags: ["ai-generated"],
  args: {
    workspaceRoot: "/home/operator/projects/llame",
    machineName: undefined,
    machine: undefined,
    project: null,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("This host")).toBeVisible();
    await expect(canvas.getByText("None")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Copy Workspace path" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "Copy Workspace locator" }),
    ).toBeNull();
  },
};

/** An unbound Chat says it has no Workspace and claims no location. */
export const NoWorkspace: Story = {
  tags: ["ai-generated"],
  args: {
    workspaceRoot: null,
    machineName: undefined,
    machine: undefined,
    project: null,
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByText("Runs on")).toBeNull();
    await expect(canvas.getByText("Workspace")).toBeVisible();
    await expect(canvas.getAllByText("None")).toHaveLength(2);
    await expect(
      canvas.queryByRole("button", { name: "Copy Workspace path" }),
    ).toBeNull();
  },
};
