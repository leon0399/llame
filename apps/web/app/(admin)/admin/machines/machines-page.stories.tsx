import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { vi } from "vitest";

// Import through the real specifier: sb.mock redirects it to the controllable
// mock registered in preview.tsx, so the page and these stories agree on the
// hook.
import * as machinesQueries from "@/lib/services/machines/queries";
import { refetchMachines } from "@/lib/services/machines/__mocks__/queries";
import type { MachineResponse } from "@/lib/services/machines/queries";

import AdminMachinesPage from "./page";

const useMachinesQuery = vi.mocked(machinesQueries.useMachinesQuery, {
  partial: true,
});

const SEEN = new Date(Date.now() - 3 * 60_000).toISOString();

const devl: MachineResponse = {
  name: "devl",
  status: "online",
  lastSeenAt: SEEN,
  failureReason: null,
  hubProtocolVersion: 8,
  daemonProtocolVersion: 7,
  daemonVersion: "0.6.1",
  facts: {
    os: "linux",
    arch: "x64",
    kernel: "6.8.0",
    cpuCount: 16,
    totalMemoryBytes: 64 * 1024 ** 3,
    rootDisks: [{ root: "/srv/projects", totalBytes: 1024 ** 4 }],
  },
  factsCapturedAt: SEEN,
  roots: ["/srv/projects"],
};

const meta = {
  component: AdminMachinesPage,
  tags: ["autodocs"],
  beforeEach: () => {
    useMachinesQuery.mockReturnValue({
      data: [devl],
      isPending: false,
      isError: false,
      refetch: refetchMachines,
    });
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AdminMachinesPage>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The instance's Machines as the same rows owners see in Settings, without
 * the owner's use switch: an operator does not turn a Machine off for
 * themself here.
 *
 * @summary the instance's Machines as rows, without the use switch
 */
export const Rows: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Each row's h3 sits under the page's h2, so headings never skip a level.
    await expect(
      canvas.getByRole("heading", { level: 2, name: "Configured Machines" }),
    ).toBeVisible();
    const heading = canvas.getByRole("heading", { level: 3, name: "devl" });
    const item = heading.closest("li");

    if (item === null) throw new Error("no row for devl");

    await expect(item).toHaveTextContent("daemon 0.6.1, outdated");
    await expect(within(item).queryByRole("switch")).toBeNull();
    await expect(within(item).getByText("16 cores")).toBeVisible();
  },
};
