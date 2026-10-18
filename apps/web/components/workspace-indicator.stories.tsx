import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor, within } from "storybook/test";
import { vi } from "vitest";

import { TooltipProvider } from "@workspace/ui/components/tooltip";

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
    // A local Workspace is not a Machine: the Machines list is queried
    // disabled, so nothing about a Machine can appear or cause a request.
    await expect(useMachinesQuery.mock.calls.at(-1)?.[0]).toBe(false);
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
 * A Workspace on a reachable Machine names the Machine and says it is online.
 * The header shows the name, not the path: a Machine path is only meaningful
 * with the Machine it is on.
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
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText("devl · Online")).toBeVisible();
    // The status is in the accessible name, not only in the dot's color.
    const trigger = canvas.getByLabelText(
      `Workspace: ${DEVL_ROOT} (devl, online)`,
    );

    await userEvent.hover(trigger);
    const tooltip = await waitFor(() => {
      const content = document.querySelector<HTMLElement>(
        "[data-slot='tooltip-content']",
      );
      expect(content).toBeVisible();
      return content;
    });
    await expect(tooltip).toHaveTextContent(DEVL_ROOT);
    await expect(tooltip).toHaveTextContent("devl is online");
  },
};

/**
 * The spec's indicator scenario: a Chat bound to a `devl` Workspace while the
 * Machine is offline keeps its binding and reports the state.
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
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText("devl · Offline")).toBeVisible();
    await expect(
      canvas.getByLabelText(`Workspace: ${DEVL_ROOT} (devl, offline)`),
    ).toBeVisible();

    await userEvent.hover(
      canvas.getByLabelText(`Workspace: ${DEVL_ROOT} (devl, offline)`),
    );
    const tooltip = await waitFor(() => {
      const content = document.querySelector<HTMLElement>(
        "[data-slot='tooltip-content']",
      );
      expect(content).toBeVisible();
      return content;
    });
    await expect(tooltip).toHaveTextContent("devl is offline");
  },
};

/**
 * A Workspace whose Machine is no longer in the configured list — the operator
 * removed it — still names the Machine it is bound to. The indicator cannot
 * claim a status it cannot read, so it claims none.
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
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText("devl")).toBeVisible();
    await expect(canvas.queryByText(/Online|Offline/)).toBeNull();

    // The name is still announced; the state has no readable source, so the
    // label claims none.
    await userEvent.hover(
      canvas.getByLabelText(`Workspace: ${DEVL_ROOT} (devl)`),
    );
    const tooltip = await waitFor(() => {
      const content = document.querySelector<HTMLElement>(
        "[data-slot='tooltip-content']",
      );
      expect(content).toBeVisible();
      return content;
    });
    await expect(tooltip).not.toHaveTextContent("devl is");
  },
};
