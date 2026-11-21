import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { vi } from "vitest";

// Import through the real specifier: sb.mock redirects it to the controllable
// mock registered in preview.tsx, so the component and these stories agree on
// the hook.
import * as machinesQueries from "@/lib/services/machines/queries";
import { refetchMachines } from "@/lib/services/machines/__mocks__/queries";
import type { MachineResponse } from "@/lib/services/machines/queries";
import { MachinesSection } from "./machines-section";

const useMachinesQuery = vi.mocked(machinesQueries.useMachinesQuery, {
  partial: true,
});

// Relative to load, so "3 minutes ago" stays "3 minutes ago" while the story
// runs; a fixed date would drift the same way a real last-seen timestamp does.
const LAST_SEEN = new Date(Date.now() - 3 * 60_000).toISOString();

function machine(
  overrides: Partial<MachineResponse> & { name: string },
): MachineResponse {
  return {
    status: "online",
    lastSeenAt: LAST_SEEN,
    failureReason: null,
    hubProtocolVersion: 2,
    daemonProtocolVersion: 2,
    daemonVersion: "0.0.2",
    facts: null,
    factsCapturedAt: null,
    roots: ["/srv/projects"],
    ...overrides,
  };
}

const onlineDevl = machine({ name: "devl" });

const offlineDevl = machine({
  name: "devl",
  status: "offline",
  failureReason: "host_key_mismatch",
});

const withFacts = machine({
  name: "devl",
  facts: {
    os: "linux",
    arch: "x64",
    kernel: "6.8.0-45-generic",
    cpuCount: 8,
    totalMemoryBytes: 16_000_000_000,
    rootDisks: [{ root: "/srv/projects", totalBytes: 500_000_000_000 }],
  },
  factsCapturedAt: LAST_SEEN,
});

const identityChanged = machine({
  name: "devl",
  status: "offline",
  failureReason: "identity_mismatch",
});

const neverConnected = machine({
  name: "builder",
  status: "offline",
  lastSeenAt: null,
  daemonProtocolVersion: null,
  daemonVersion: null,
  roots: [],
});

const meta = {
  component: MachinesSection,
  tags: ["autodocs"],
  beforeEach: () => {
    useMachinesQuery.mockReturnValue({
      data: [onlineDevl],
      isPending: false,
      isError: false,
      refetch: refetchMachines,
    });
    refetchMachines.mockClear();
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof MachinesSection>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * A reachable Machine: name, state, when the hub last completed a handshake,
 * the two protocol versions it agreed on, and the roots it accepts.
 *
 * @summary online Machine with its versions and roots
 */
export const Online: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Machines")).toBeVisible();
    await expect(canvas.getByText("devl")).toBeVisible();
    await expect(canvas.getByText("Online")).toBeVisible();

    const seen = canvasElement.querySelector("time");
    await expect(seen).toHaveAttribute("dateTime", LAST_SEEN);
    await expect(seen).toHaveTextContent("3 minutes ago");

    await expect(
      canvas.getByText("Hub protocol v2 · daemon 0.0.2 (protocol v2)"),
    ).toBeVisible();
    await expect(canvas.getByText("/srv/projects")).toBeVisible();
    // Nothing failed, so there is no failure row to read.
    await expect(canvas.queryByText("Last failure")).toBeNull();
    // No handshake has reported facts, so there is no system row either.
    await expect(canvas.queryByText("System")).toBeNull();
  },
};

/**
 * A daemon reports its OS and architecture at each handshake, so the owner can
 * tell a Linux box from a macOS one before entering a Workspace on it.
 *
 * @summary online Machine with the OS and architecture it reported
 */
export const OnlineWithFacts: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useMachinesQuery.mockReturnValue({
      data: [withFacts],
      isPending: false,
      isError: false,
      refetch: refetchMachines,
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("System")).toBeVisible();
    await expect(canvas.getByText("linux x64")).toBeVisible();
    // The facts carry a kernel, a CPU count, and memory sizes; the row says
    // only what the owner acts on, and never the instance id.
    await expect(canvas.queryByText(/6\.8\.0/)).toBeNull();
    await expect(canvas.queryByText(/instance/i)).toBeNull();
  },
};

/**
 * A daemon that answers with a different instance id than the one bound to its
 * name is refused, so the owner sees the identity change rather than a
 * connection problem that would invite a retry.
 *
 * @summary offline Machine whose identity changed
 */
export const IdentityChanged: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useMachinesQuery.mockReturnValue({
      data: [identityChanged],
      isPending: false,
      isError: false,
      refetch: refetchMachines,
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Offline")).toBeVisible();
    await expect(canvas.getByText("Last failure")).toBeVisible();
    await expect(canvas.getByText("Identity changed")).toBeVisible();
  },
};

/**
 * The spec's offline scenario: a Machine whose pinned host key no longer
 * matches is reported offline with that reason and its last-seen time, so the
 * owner can tell a moved key from a machine that simply is not up.
 *
 * @summary offline Machine names its last failure
 */
export const Offline: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useMachinesQuery.mockReturnValue({
      data: [offlineDevl],
      isPending: false,
      isError: false,
      refetch: refetchMachines,
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Offline")).toBeVisible();
    await expect(canvas.getByText("Last failure")).toBeVisible();
    await expect(canvas.getByText("Host key does not match")).toBeVisible();
    // The last-seen time survives the failure: it says when the Machine was
    // last known good, which is what dates the failure.
    await expect(canvasElement.querySelector("time")).toHaveTextContent(
      "3 minutes ago",
    );
  },
};

/**
 * A Machine the hub has never completed a handshake with has no last-seen
 * time and no daemon version. Both say so instead of rendering an epoch date
 * or an empty cell.
 *
 * @summary configured but never contacted
 */
export const NeverConnected: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useMachinesQuery.mockReturnValue({
      data: [neverConnected],
      isPending: false,
      isError: false,
      refetch: refetchMachines,
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("builder")).toBeVisible();
    await expect(canvas.getByText("Never connected")).toBeVisible();
    await expect(
      canvas.getByText("Hub protocol v2 · daemon not contacted yet"),
    ).toBeVisible();
    await expect(canvas.getByText("No roots registered")).toBeVisible();
    // No handshake, so no timestamp element at all.
    await expect(canvasElement.querySelector("time")).toBeNull();
  },
};

/**
 * An instance whose operator configured no Machines has no Machines route:
 * the API answers 404 and `fetchMachines` maps that to an empty list. The
 * section must not exist at all — an empty card would advertise a capability
 * the instance does not have.
 *
 * @summary hidden when no Machines are configured
 */
export const NotConfigured: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useMachinesQuery.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch: refetchMachines,
    });
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-slot="card"]')).toBeNull();
    await expect(canvasElement).toBeEmptyDOMElement();
  },
};

/**
 * A pending read stays hidden for the same reason: for an instance without
 * Machines the card would flash in and back out, and for one with them it
 * would arrive empty and then fill.
 *
 * @summary hidden while the status read is in flight
 */
export const Loading: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useMachinesQuery.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: refetchMachines,
    });
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toBeEmptyDOMElement();
  },
};

/**
 * A failed read is not the absence of Machines, so it is announced rather
 * than swallowed. `Alert` carries `role="alert"` and the retry path refetches
 * the polled query.
 *
 * @summary failed status read, with a retry path
 */
export const LoadFailed: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useMachinesQuery.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: refetchMachines,
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Could not load Machines.",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(refetchMachines).toHaveBeenCalled();
  },
};
