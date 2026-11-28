import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { vi } from "vitest";

import { TooltipProvider } from "@workspace/ui/components/tooltip";

// Import through the real specifier: sb.mock redirects it to the controllable
// mock registered in preview.tsx.
import * as machinesQueries from "@/lib/services/machines/queries";
import { refetchMachines } from "@/lib/services/machines/__mocks__/queries";
import type { MachineResponse } from "@/lib/services/machines/queries";

import { AppStatusBar } from "./app-status-bar";

const useMachinesQuery = vi.mocked(machinesQueries.useMachinesQuery, {
  partial: true,
});

const LAST_SEEN = new Date(Date.now() - 2 * 60_000).toISOString();

const GIB = 1024 ** 3;

function machine(
  overrides: Partial<MachineResponse> & { name: string },
): MachineResponse {
  return {
    status: "online",
    lastSeenAt: LAST_SEEN,
    failureReason: null,
    hubProtocolVersion: 8,
    daemonProtocolVersion: 8,
    daemonVersion: "0.6.2",
    facts: {
      os: "linux",
      arch: "arm64",
      kernel: "6.8",
      cpuCount: 4,
      totalMemoryBytes: 8 * GIB,
      rootDisks: [{ root: "/srv/src", totalBytes: 256 * GIB }],
    },
    factsCapturedAt: LAST_SEEN,
    roots: ["/srv/src"],
    ...overrides,
  };
}

const MACHINES = [
  machine({ name: "devl" }),
  machine({
    name: "services",
    daemonProtocolVersion: 7,
    daemonVersion: "0.6.1",
  }),
  machine({
    name: "builder",
    status: "offline",
    lastSeenAt: null,
    facts: null,
  }),
];

const meta = {
  component: AppStatusBar,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  beforeEach: () => {
    useMachinesQuery.mockReturnValue({
      data: MACHINES,
      isPending: false,
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
} satisfies Meta<typeof AppStatusBar>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The bar names a Machine whose daemon is older than the hub's, so an update
 * is not found only by opening the Machines page, then the Machines by name
 * and how many are online.
 *
 * @summary the outdated item, the named Machines and the online count
 */
export const Machines: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement);

    await expect(
      bar.getByRole("link", { name: "services runs an older daemon" }),
    ).toHaveAttribute("href", "/settings/machines");
    await expect(bar.getByText("2/3 Machines online")).toBeVisible();
  },
};

/**
 * Hovering a Machine previews its row from the Machines page: its state and
 * last contact, and its CPU, memory and disk meters with their capacity.
 *
 * @summary a Machine's preview on hover
 */
export const MachinePreview: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("link", {
      // The name, then the hidden state: "services , online".
      name: /^services\s*, online$/,
    });

    await userEvent.hover(trigger);

    let card: HTMLElement | null = null;

    await waitFor(
      () => {
        card = document.querySelector<HTMLElement>(
          "[data-slot='hover-card-content']",
        );
        expect(card).toBeVisible();
      },
      { timeout: 2000 },
    );

    if (card === null) throw new Error("Expected an open preview");

    const preview = within(card);

    await expect(preview.getByText("Older daemon")).toBeVisible();
    await expect(preview.getByText(/seen 2 minutes ago/)).toBeVisible();
    await expect(preview.getByText("4 cores")).toBeVisible();
    await expect(preview.getByText("8 GiB")).toBeVisible();
    await expect(preview.getByText("256 GiB")).toBeVisible();
  },
};
