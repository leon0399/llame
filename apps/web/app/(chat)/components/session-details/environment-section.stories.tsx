import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen, waitFor } from "storybook/test";

import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from "@workspace/ui/components/sidebar";

import {
  EnvironmentSection,
  type EnvironmentSectionProps,
} from "./environment-section";

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
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <SidebarProvider keyboardShortcut={null}>
        <Sidebar collapsible="none">
          <SidebarContent>
            <Story />
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    ),
  ],
  args: {
    chatLoaded: true,
    workspaceRoot: DEVBOX_ROOT,
    checkout: null,
    machineName: "devbox",
    machine: onlineDevbox,
    machineLoading: false,
    project: { id: "11111111-1111-4111-8111-111111111111", name: "llame" },
  },
} satisfies Meta<typeof EnvironmentSection>;

export default meta;
type Story = StoryObj<typeof meta>;

// Reading the real clipboard back needs a permission grant the headless
// runner does not give, so the copy stories swap in a writeText spy.
const writeText = fn<(text: string) => Promise<void>>();

function stubClipboard() {
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
}

/**
 * A Chat in a Project, entered into a Workspace on an online Machine: three
 * rows. The path row only states the Machine-local path; its copy control
 * offers that path or the `machine://` locator the tools take.
 *
 * @summary Machine Workspace, online, in a Project
 */
export const MachineOnline: Story = {
  // Base UI's portalled menu leaves aria-hidden focus guards that axe's
  // aria-hidden-focus rule misreads (as in chat-composer.stories.tsx).
  parameters: {
    a11y: {
      config: { rules: [{ id: "aria-hidden-focus", enabled: false }] },
    },
  },
  tags: ["ai-generated"],
  beforeEach: stubClipboard,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole("link", { name: "llame" })).toHaveAttribute(
      "href",
      "/projects/11111111-1111-4111-8111-111111111111",
    );
    await expect(
      canvas.getByRole("link", { name: "devbox, Online" }),
    ).toBeVisible();
    await expect(canvas.getByText("Online")).toBeVisible();
    await expect(canvas.getByText("/home/box/work/shop")).toBeVisible();

    await userEvent.click(
      canvas.getByRole("button", { name: "Copy path or locator" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Path on devbox" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("/home/box/work/shop"),
    );
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    await userEvent.click(
      canvas.getByRole("button", { name: "Copy path or locator" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Locator" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(DEVBOX_ROOT));
    // The menu's focus guards linger until it has fully closed.
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  },
};

/**
 * A Workspace that is a registered worktree: the repository as a link to its
 * GitHub page, named `owner/name`, and the branch marked as a worktree.
 *
 * @summary Machine worktree with its repository link and branch
 */
export const RegisteredWorktree: Story = {
  tags: ["ai-generated"],
  args: {
    checkout: {
      repository: "shop",
      remote: "github.com/acme/shop",
      kind: "worktree",
      branch: "llame/clear-field-0192",
    },
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("link", {
        name: "acme/shop on GitHub, opens in a new tab",
      }),
    ).toHaveAttribute("href", "https://github.com/acme/shop");
    await expect(canvas.getByText("llame/clear-field-0192")).toBeVisible();
    await expect(canvas.getByText("Worktree")).toBeVisible();
  },
};

/** Seen a few seconds before the story renders, so the label starts in
 *  seconds and its next tick is observable. */
function SeenMomentsAgo(args: EnvironmentSectionProps) {
  const [lastSeenAt] = useState(() =>
    new Date(Date.now() - 5000).toISOString(),
  );
  return (
    <EnvironmentSection {...args} machine={{ ...onlineDevbox, lastSeenAt }} />
  );
}

/**
 * Hovering the Machine shows when the hub last reached it, and the label
 * keeps counting while the tooltip is open.
 *
 * @summary the Machine's last-seen tooltip counts up live
 */
export const LastSeenTicks: Story = {
  tags: ["ai-generated"],
  render: (args) => <SeenMomentsAgo {...args} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByRole("link", { name: "devbox, Online" }));
    const tooltip = await waitFor(() => {
      const content = document.querySelector<HTMLElement>(
        "[data-slot='tooltip-content']",
      );
      expect(content).toHaveTextContent(/^Last seen \d+ seconds ago$/);
      return content;
    });
    const first = tooltip?.textContent;
    await waitFor(() => expect(tooltip?.textContent).not.toBe(first), {
      timeout: 2500,
    });
  },
};

/**
 * An offline Machine keeps the binding; the reason is spelled out.
 *
 * @summary Machine Workspace, offline, with its failure reason
 */
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
    await expect(canvas.getByText("Offline")).toBeVisible();
    await expect(canvas.getByText("Host key does not match")).toBeVisible();
  },
};

/**
 * A Machine the operator removed: named, with no state claimed.
 *
 * @summary Machine Workspace whose Machine is no longer configured
 */
export const MachineUnknown: Story = {
  tags: ["ai-generated"],
  args: { machine: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Unknown")).toBeVisible();
  },
};

/**
 * A local Workspace on this host: one copy action, no locator.
 *
 * @summary local Workspace with a copy-path action
 */
export const LocalWorkspace: Story = {
  tags: ["ai-generated"],
  args: {
    workspaceRoot: "/home/operator/projects/llame",
    machineName: undefined,
    machine: undefined,
    project: null,
  },
  beforeEach: stubClipboard,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText("This host")).toBeVisible();
    await expect(canvas.queryByRole("link")).toBeNull();

    await userEvent.click(canvas.getByRole("button", { name: "Copy path" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("/home/operator/projects/llame"),
    );
  },
};

/**
 * An unbound Chat with no Project is one quiet row.
 *
 * @summary Chat with no Workspace and no Project
 */
export const NoWorkspace: Story = {
  tags: ["ai-generated"],
  args: {
    workspaceRoot: null,
    machineName: undefined,
    machine: undefined,
    project: null,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No Workspace")).toBeVisible();
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

/** Before the Chat's card arrives, the section is skeleton rows, not a
 *  claim that the Chat has no Workspace. */
export const LoadingChat: Story = {
  tags: ["ai-generated"],
  args: { chatLoaded: false },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelectorAll("[data-sidebar=menu-skeleton]"),
    ).toHaveLength(2);
    await expect(canvasElement).not.toHaveTextContent("No Workspace");
  },
};

/** While the Project and the Machine status load, their slots are
 *  skeletons; the Workspace path, already known, is shown. */
export const LoadingDetails: Story = {
  tags: ["ai-generated"],
  args: { project: undefined, machine: undefined, machineLoading: true },
  play: async ({ canvas, canvasElement }) => {
    await expect(
      canvasElement.querySelector("[data-sidebar=menu-skeleton]"),
    ).not.toBeNull();
    await expect(
      canvasElement.querySelector("[data-slot=skeleton]"),
    ).not.toBeNull();
    await expect(canvas.queryByText("Unknown")).toBeNull();
    await expect(canvas.getByText("/home/box/work/shop")).toBeVisible();
  },
};
