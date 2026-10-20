import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, within } from "storybook/test";
import { vi } from "vitest";

import * as machinesQueries from "@/lib/services/machines/queries";
import { refetchMachines } from "@/lib/services/machines/__mocks__/queries";
import { WorkspaceIndicator } from "./workspace-indicator";

const useMachinesQuery = vi.mocked(machinesQueries.useMachinesQuery, {
  partial: true,
});

const DEVL_ROOT = "machine://devl/home/leo/projects/llame";

const onlineDevl = {
  name: "devl",
  status: "online" as const,
  lastSeenAt: new Date(Date.now() - 60_000).toISOString(),
  failureReason: null,
  hubProtocolVersion: 1,
  daemonProtocolVersion: 1,
  daemonVersion: "0.1.0",
  roots: ["/home/leo/projects"],
};

const meta = {
  component: WorkspaceIndicator,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  beforeEach: () => {
    // Pending by default: a local Workspace never reads the Machines list, and
    // that is the state the local stories would see on a real instance.
    useMachinesQuery.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: refetchMachines,
    });
  },
  args: { expanded: false, onActivate: fn() },
} satisfies Meta<typeof WorkspaceIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The compact final-segment label shown for a bound Chat Workspace; it
 *  opens the context panel. */
export const Bound: Story = {
  tags: ["ai-generated"],
  args: { workspaceRoot: "/home/operator/projects/llame" },
  play: async ({ args, canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", {
      name: "Workspace: /home/operator/projects/llame",
    });
    await expect(trigger).toHaveTextContent("llame");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(trigger);
    await expect(args.onActivate).toHaveBeenCalledOnce();
    // A local Workspace is not a Machine: the Machines list is queried
    // disabled, so nothing about a Machine can appear or cause a request.
    await expect(useMachinesQuery.mock.calls.at(-1)?.[0]).toBe(false);
  },
};

/** While the panel is showing, the badge reports itself expanded. */
export const PanelOpen: Story = {
  tags: ["ai-generated"],
  args: { workspaceRoot: "/home/operator/projects/llame", expanded: true },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: /^Workspace:/ }),
    ).toHaveAttribute("aria-expanded", "true");
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

/**
 * A Workspace on a reachable Machine names the Machine and the root's final
 * segment; the state is in the accessible name and the dot.
 *
 * @summary Machine Workspace with a reachable Machine
 */
export const MachineOnline: Story = {
  tags: ["ai-generated"],
  args: { workspaceRoot: DEVL_ROOT },
  beforeEach: () => {
    useMachinesQuery.mockReturnValue({
      data: [onlineDevl],
      isPending: false,
      isError: false,
      refetch: refetchMachines,
    });
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("devl · llame")).toBeVisible();
    await expect(
      canvas.getByRole("button", {
        name: `Workspace: ${DEVL_ROOT} (devl, online)`,
      }),
    ).toBeVisible();
  },
};

/** A Workspace at a Machine's `/` reads as the root, not the Machine's name
 *  twice. */
export const MachineRoot: Story = {
  tags: ["ai-generated"],
  args: { workspaceRoot: "machine://devl/" },
  beforeEach: () => {
    useMachinesQuery.mockReturnValue({
      data: [onlineDevl],
      isPending: false,
      isError: false,
      refetch: refetchMachines,
    });
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("devl · /")).toBeVisible();
  },
};

/**
 * The spec's indicator scenario: a Chat bound to a `devl` Workspace while the
 * Machine is offline keeps its binding and says so in text.
 *
 * @summary Machine Workspace with an offline Machine
 */
export const MachineOffline: Story = {
  tags: ["ai-generated"],
  args: { workspaceRoot: DEVL_ROOT },
  beforeEach: () => {
    useMachinesQuery.mockReturnValue({
      data: [
        {
          ...onlineDevl,
          status: "offline",
          failureReason: "unreachable",
        },
      ],
      isPending: false,
      isError: false,
      refetch: refetchMachines,
    });
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("devl · llame · Offline")).toBeVisible();
    await expect(
      canvas.getByRole("button", {
        name: `Workspace: ${DEVL_ROOT} (devl, offline)`,
      }),
    ).toBeVisible();
  },
};

/**
 * A Workspace whose Machine is no longer in the configured list — the operator
 * removed it — still names the Machine it is bound to, and claims no state.
 *
 * @summary Machine Workspace with no status known
 */
export const MachineUnknown: Story = {
  tags: ["ai-generated"],
  args: { workspaceRoot: DEVL_ROOT },
  beforeEach: () => {
    useMachinesQuery.mockReturnValue({
      data: [{ ...onlineDevl, name: "other" }],
      isPending: false,
      isError: false,
      refetch: refetchMachines,
    });
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("devl · llame")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: `Workspace: ${DEVL_ROOT} (devl)` }),
    ).toBeVisible();
  },
};
