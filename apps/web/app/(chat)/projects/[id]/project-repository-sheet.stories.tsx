import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { vi } from "vitest";

// Import through the real specifier: sb.mock redirects it to the controllable
// mock registered in preview.tsx, so the rows and these stories agree on it.
import * as machinesQueries from "@/lib/services/machines/queries";

import { RepositorySheet } from "./project-repository-sheet";
import {
  api,
  clearFieldWorktree,
  link,
  llame,
  localClone,
  machineClone,
  routeFetch,
  sentBody,
  sentRoutes,
} from "./project-repository-story-support";

const useMachinesQuery = vi.mocked(machinesQueries.useMachinesQuery, {
  partial: true,
});

const PATCH_ROUTE = "PATCH /api/v1/projects/p1/repositories/r1";
const REMOVE_ROUTE = "DELETE /api/v1/checkouts/c2/worktree";

// Reading the real clipboard back needs a permission grant the headless
// runner does not give, so the copy story swaps in a writeText spy.
const writeText = fn<(text: string) => Promise<void>>();

function stubClipboard() {
  writeText.mockReset().mockResolvedValue(undefined);
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return () => {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else Reflect.deleteProperty(navigator, "clipboard");
  };
}

const meta = {
  component: RepositorySheet,
  tags: ["autodocs"],
  args: {
    projectId: "p1",
    link: link({ repositoryId: "r1", alias: "llame", isPrimary: true }),
    repository: llame,
    checkouts: {
      status: "loaded",
      rows: [localClone, machineClone, clearFieldWorktree],
    },
    open: true,
    onOpenChange: fn(),
  },
  beforeEach: () => {
    api.refusal = null;
    useMachinesQuery.mockReturnValue({
      data: [
        {
          name: "devbox",
          status: "online",
          lastSeenAt: "2026-10-24T10:00:00.000Z",
          failureReason: null,
          hubProtocolVersion: 1,
          daemonProtocolVersion: 1,
          daemonVersion: "0.1.0",
          roots: ["/home/box/work"],
        },
      ],
      isPending: false,
      isError: false,
    });
    return routeFetch();
  },
} satisfies Meta<typeof RepositorySheet>;

export default meta;
type Story = StoryObj<typeof meta>;

async function sheet() {
  return within(await screen.findByRole("dialog", { name: "llame" }));
}

/**
 * The sheet's three bands: settings, the clones, and the worktrees. A
 * Machine clone shows the path a terminal there takes and whether the
 * Machine is reachable; the worktree names the chat that made it, as a link
 * to that chat, and how many others share it.
 *
 * @summary settings, local and Machine clones, and a worktree with its chats
 */
export const Overview: Story = {
  tags: ["ai-generated"],
  play: async () => {
    const view = await sheet();

    await expect(view.getByLabelText("Name")).toHaveValue("llame");
    await expect(view.getByRole("switch", { name: "Primary" })).toBeChecked();
    await expect(view.getByText("/home/leo/src/llame")).toBeVisible();
    await expect(view.getByText("/home/box/work/llame")).toBeVisible();
    await expect(view.getAllByText(", Online")).toHaveLength(1);
    await expect(view.getByText("llame/clear-field-0192")).toBeVisible();
    await expect(
      await view.findByRole("link", { name: "Clear field" }),
    ).toHaveAttribute("href", "/chat/chat-1");
    await expect(view.getByText(/1 other chat/)).toBeVisible();
    await expect(
      view.getByRole("link", { name: "Open on GitHub" }),
    ).toHaveAttribute("href", "https://github.com/leon0399/llame");
  },
};

/**
 * A checkout read that failed is said as such, not shown as a repository with
 * no clones or worktrees.
 *
 * @summary a failed checkout read
 */
export const CheckoutsUnavailable: Story = {
  tags: ["ai-generated"],
  args: { checkouts: { status: "error" } },
  play: async () => {
    const view = await sheet();

    await expect(
      view.getAllByText("Could not load the checkouts."),
    ).toHaveLength(2);
    await expect(view.queryByText(/^No checkout yet/)).not.toBeInTheDocument();
  },
};

/**
 * Settings save as they change: the worktree choice writes at once, and so
 * does Primary.
 *
 * @summary changing the worktree choice and Primary patches the link
 */
export const SettingsSave: Story = {
  tags: ["ai-generated"],
  play: async () => {
    const view = await sheet();

    await userEvent.click(view.getByRole("combobox", { name: "Worktrees" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "Always" }),
    );
    // The closing popup's unnamed listbox would otherwise still be mounted
    // when the story's accessibility scan runs.
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(sentRoutes()).toContain(PATCH_ROUTE));
    await expect(sentBody(PATCH_ROUTE)).resolves.toEqual({
      isolation: "always_worktree",
    });

    const primary = view.getByRole("switch", { name: "Primary" });
    await waitFor(() => expect(primary).toBeEnabled());
    await userEvent.click(primary);
    await waitFor(() =>
      expect(
        sentRoutes().filter((route) => route === PATCH_ROUTE),
      ).toHaveLength(2),
    );
  },
};

/**
 * The checkouts' `+` adds a draft row for another clone's path; Enter
 * registers it under this repository.
 *
 * @summary the checkout draft registers a path under the repository
 */
export const AddCheckout: Story = {
  tags: ["ai-generated"],
  play: async () => {
    const view = await sheet();

    await userEvent.click(view.getByRole("button", { name: "Add checkout" }));
    await userEvent.type(
      view.getByRole("textbox", { name: "Add checkout" }),
      "/home/leo/other/llame{Enter}",
    );
    await waitFor(() =>
      expect(sentRoutes()).toContain("POST /api/v1/checkouts"),
    );
    await expect(sentBody("POST /api/v1/checkouts")).resolves.toEqual({
      path: "/home/leo/other/llame",
      repositoryId: "r1",
    });
  },
};

/**
 * A host path copies at once; the icon turns into a check for a moment.
 *
 * @summary copying a local clone's path
 */
export const CopyPath: Story = {
  tags: ["ai-generated"],
  beforeEach: stubClipboard,
  play: async () => {
    const view = await sheet();

    const [localCopy] = view.getAllByRole("button", { name: "Copy path" });
    if (localCopy === undefined) throw new Error("no local copy button");
    await userEvent.click(localCopy);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("/home/leo/src/llame"),
    );
    await expect(
      view.getByText("Copied", { selector: "output" }),
    ).toBeInTheDocument();
  },
};

/**
 * A Machine clone's copy offers the path on that Machine or the locator the
 * tools take.
 *
 * @summary copying a Machine clone's locator
 */
export const CopyLocator: Story = {
  tags: ["ai-generated"],
  beforeEach: stubClipboard,
  play: async () => {
    const view = await sheet();

    await userEvent.click(
      view.getByRole("button", { name: "Copy path or locator" }),
    );
    const item = await screen.findByRole("menuitem", {
      name: "Path on devbox",
    });
    // The menu fades in; its items are visible once that ends.
    await waitFor(() => expect(item).toBeVisible());
    await userEvent.click(screen.getByRole("menuitem", { name: "Locator" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "machine://devbox/home/box/work/llame",
      ),
    );
  },
};

/**
 * The guarded removal: the route answers 409 with its own sentence, and
 * that sentence appears beside the worktree, which stays listed.
 *
 * @summary a refused worktree removal shows the server's refusal
 */
export const RemoveRefused: Story = {
  tags: ["ai-generated"],
  // The confirm action's destructive Button tint (#232), not this sheet.
  parameters: { ...contrastKnownIssue232 },
  beforeEach: () => {
    api.refusal = {
      status: 409,
      body: {
        statusCode: 409,
        error: "Conflict",
        code: "worktree_not_clean",
        message: "The worktree holds uncommitted changes.",
      },
    };
  },
  play: async () => {
    const view = await sheet();

    await userEvent.click(
      view.getByRole("button", { name: "Remove worktree" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Remove" }),
    );

    await expect(
      await view.findByText("The worktree holds uncommitted changes."),
    ).toBeVisible();
    await expect(view.getByText("llame/clear-field-0192")).toBeVisible();
    await expect(sentRoutes()).toContain(REMOVE_ROUTE);
  },
};

/**
 * Unlink sits in the header's menu and asks first; the link goes and the
 * clones stay.
 *
 * @summary unlinking from the header menu
 */
export const Unlink: Story = {
  tags: ["ai-generated"],
  // The confirm action's destructive Button tint (#232), not this sheet.
  parameters: { ...contrastKnownIssue232 },
  play: async () => {
    const view = await sheet();

    await userEvent.click(view.getByRole("button", { name: "More actions" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Unlink from project" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Unlink" }),
    );
    await waitFor(() =>
      expect(sentRoutes()).toContain(
        "DELETE /api/v1/projects/p1/repositories/r1",
      ),
    );
  },
};
