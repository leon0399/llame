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
      arch: "x64",
      kernel: "6.8.0-45-generic",
      cpuCount: 16,
      totalMemoryBytes: 64 * GIB,
      rootDisks: [{ root: "/srv/projects", totalBytes: 1024 * GIB }],
    },
    factsCapturedAt: LAST_SEEN,
    roots: ["/srv/projects"],
    ...overrides,
  };
}

const current = machine({ name: "devl" });

const outdated = machine({
  name: "gpu",
  daemonProtocolVersion: 7,
  daemonVersion: "0.6.1",
});

const neverConnected = machine({
  name: "builder",
  status: "offline",
  lastSeenAt: null,
  daemonProtocolVersion: null,
  daemonVersion: null,
  facts: null,
  factsCapturedAt: null,
  roots: [],
});

const hostKeyChanged = machine({
  name: "old-vps",
  status: "offline",
  failureReason: "host_key_mismatch",
});

function listed(data: Array<MachineResponse>) {
  useMachinesQuery.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    refetch: refetchMachines,
  });
}

/** The row of the Machine named `name`. */
function row(canvasElement: HTMLElement, name: string) {
  const heading = within(canvasElement).getByRole("heading", { name });
  const item = heading.closest("li");

  if (item === null) throw new Error(`no row for ${name}`);

  return item;
}

/** The meta line under a row's name: contact, system and daemon version. */
function metaLine(item: HTMLElement) {
  const line = item.querySelector("p");

  if (line === null) throw new Error("row has no meta line");

  return line;
}

const meta = {
  component: MachinesSection,
  tags: ["autodocs"],
  beforeEach: () => {
    listed([current, outdated, neverConnected]);
    refetchMachines.mockClear();
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof MachinesSection>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * One row per Machine, each the same shape whether or not its daemon is
 * current: the name, the contact and system line ending in the daemon
 * version, and CPU, memory and disk meters with their capacity. The meters
 * read "—" until Machines report live use (#1992).
 *
 * @summary current, outdated and never-connected Machines as rows
 */
export const Rows: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const devl = row(canvasElement, "devl");

    await expect(metaLine(devl)).toHaveTextContent(
      "Online · seen 3 minutes ago · linux x64 · daemon 0.6.2",
    );
    await expect(metaLine(devl)).not.toHaveTextContent("outdated");
    await expect(within(devl).getByText("16 cores")).toBeVisible();
    await expect(within(devl).getByText("64 GiB")).toBeVisible();
    await expect(within(devl).getAllByText("1 TiB")[0]).toBeVisible();
    await expect(within(devl).getAllByText("—")).toHaveLength(3);
    await expect(
      within(devl).queryByRole("button", { name: /Update/ }),
    ).toBeNull();
    // Base UI's switch is a span: it reports disabled through ARIA, not the
    // `disabled` attribute.
    await expect(
      within(devl).getByRole("switch", { name: "Use devl (coming soon)" }),
    ).toHaveAttribute("aria-disabled", "true");
  },
};

/**
 * A daemon whose protocol is older than the hub's says so in the version it
 * already shows, and offers the update, which is not built yet (#1815).
 *
 * @summary an outdated daemon and its disabled Update
 */
export const OutdatedDaemon: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const gpu = row(canvasElement, "gpu");

    await expect(metaLine(gpu)).toHaveTextContent("daemon 0.6.1, outdated");
    await expect(
      within(gpu).getByRole("button", { name: "Update" }),
    ).toBeDisabled();
  },
};

/**
 * A Machine the hub never reached has no last contact, no version and no
 * reported capacity: each meter says "Unknown" rather than a zero.
 *
 * @summary configured but never contacted
 */
export const NeverConnected: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const builder = row(canvasElement, "builder");

    await expect(metaLine(builder)).toHaveTextContent(
      "Offline · never connected",
    );
    await expect(metaLine(builder)).not.toHaveTextContent("daemon");
    await expect(within(builder).getAllByText("Unknown")).toHaveLength(3);
    await expect(builder.querySelector("time")).toBeNull();
  },
};

/**
 * Details opens under the row: each root with the size of its disk, both
 * protocol versions, and when the Machine last reported its facts.
 *
 * @summary roots and protocol versions under a row
 */
export const DetailsOpen: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const gpu = row(canvasElement, "gpu");

    await userEvent.click(within(gpu).getByRole("button", { name: "Details" }));
    await expect(await within(gpu).findByText("/srv/projects")).toBeVisible();
    await expect(
      within(gpu).getByText("1 TiB", { selector: "span" }),
    ).toBeVisible();
    await expect(
      within(gpu).getByText("daemon protocol v7 · hub protocol v8"),
    ).toBeVisible();
    // The spec asks for the facts' capture time beside them.
    await expect(
      within(gpu)
        .getByText(/^Facts reported/)
        .closest("p"),
    ).toHaveTextContent("Facts reported 3 minutes ago");
  },
};

/**
 * The last failed attempt is named in the contact line, beside when the
 * Machine was last known good.
 *
 * @summary an offline Machine names its last failure
 */
export const Offline: Story = {
  tags: ["ai-generated"],
  beforeEach: () => listed([hostKeyChanged]),
  play: async ({ canvasElement }) => {
    await expect(metaLine(row(canvasElement, "old-vps"))).toHaveTextContent(
      "Offline · Host key does not match · seen 3 minutes ago",
    );
  },
};

const sharedFilesystem = machine({
  name: "nas",
  roots: ["/srv/projects", "/srv/data"],
  facts: {
    ...current.facts!,
    rootDisks: [
      { root: "/srv/projects", totalBytes: 1024 * GIB },
      { root: "/srv/data", totalBytes: 1024 * GIB },
    ],
  },
});

const twoDisks = machine({
  name: "storage",
  roots: ["/srv/projects", "/mnt/archive"],
  facts: {
    ...current.facts!,
    rootDisks: [
      { root: "/srv/projects", totalBytes: 1024 * GIB },
      { root: "/mnt/archive", totalBytes: 4096 * GIB },
    ],
  },
});

/**
 * Each root reports the size of the filesystem that holds it, and roots can
 * share one, so the sizes are never added: two roots on one 1 TiB disk read
 * "1 TiB", and roots on different disks read the largest.
 *
 * @summary disk capacity across several roots
 */
export const SeveralRoots: Story = {
  tags: ["ai-generated"],
  beforeEach: () => listed([sharedFilesystem, twoDisks]),
  play: async ({ canvasElement }) => {
    const nas = row(canvasElement, "nas");
    const storage = row(canvasElement, "storage");

    await expect(within(nas).getAllByText("1 TiB")[0]).toBeVisible();
    await expect(within(nas).queryByText("2 TiB")).toBeNull();
    await expect(within(storage).getByText("largest 4 TiB")).toBeVisible();
    await expect(within(storage).queryByText("5 TiB")).toBeNull();
  },
};

/**
 * An instance with no Machines configured says so instead of standing blank.
 *
 * @summary no Machines configured
 */
export const NotConfigured: Story = {
  tags: ["ai-generated"],
  beforeEach: () => listed([]),
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(
        "This instance has no Machines configured.",
      ),
    ).toBeVisible();
    await expect(within(canvasElement).queryByRole("listitem")).toBeNull();
  },
};

/**
 * While the list loads, a placeholder holds its place.
 *
 * @summary loading placeholder
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
    await expect(
      canvasElement.querySelector('[data-slot="skeleton"]'),
    ).not.toBeNull();
    await expect(within(canvasElement).queryByRole("listitem")).toBeNull();
  },
};

/**
 * A failed read is not the absence of Machines, so it is announced rather
 * than swallowed, with a retry that refetches.
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
