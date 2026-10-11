import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";

import type { OrgUnitResponse } from "@/lib/services/org-units/types";
import {
  emptyResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";
import { OrgUnitsTree } from "./org-tree";

function unit(
  overrides: Partial<OrgUnitResponse> & { id: string; name: string },
): OrgUnitResponse {
  return {
    parentId: null,
    type: "organization",
    path: overrides.id,
    settings: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    memberCount: 0,
    directRole: null,
    ...overrides,
  };
}

// Acme (owner, direct)
// ├─ Team A (leaf, no role)
// └─ Dept B (has child -> Team C)
//    └─ Team C (leaf, inherits owner from Acme)
// Home Lab (leaf root, no role anywhere)
const acme = unit({
  id: "org1",
  name: "Acme",
  type: "organization",
  path: "org1",
  directRole: "owner",
  memberCount: 5,
});
const teamA = unit({
  id: "teamA",
  name: "Team A",
  parentId: "org1",
  type: "team",
  path: "org1/teamA",
  memberCount: 2,
});
const deptB = unit({
  id: "deptB",
  name: "Dept B",
  parentId: "org1",
  type: "department",
  path: "org1/deptB",
  memberCount: 4,
});
const teamC = unit({
  id: "teamC",
  name: "Team C",
  parentId: "deptB",
  type: "team",
  path: "org1/deptB/teamC",
  memberCount: 1,
});
const homeLab = unit({
  id: "org2",
  name: "Home Lab",
  type: "organization",
  path: "org2",
});

// No hook mocking: the real mutation hooks run against a stubbed
// globalThis.fetch, so a delete that reaches the network is proved by the
// request it sends rather than by a spy the story wired up itself.
let fetchMock: Mock<typeof fetch>;

function stubOrgUnitsFetch() {
  fetchMock = stubFetch();
  fetchMock.mockImplementation(async () => emptyResponse());
  return () => {
    vi.unstubAllGlobals();
  };
}

const meta = {
  component: OrgUnitsTree,
  tags: ["autodocs"],
  args: { units: [acme, teamA, deptB, teamC, homeLab] },
  // Every story renders the toolbar's unit-count chip, muted-foreground on
  // bg-secondary (~4.3:1) — the tracked #232 token contrast defect.
  parameters: contrastKnownIssue232,
} satisfies Meta<typeof OrgUnitsTree>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Cancel the open form dialog and wait until it has gone. */
async function cancelDialog(heading: string) {
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: heading }),
    ).not.toBeInTheDocument(),
  );
}

/**
 * The admin org tree with a nested department, a second root, and a role
 * held directly only on Acme: every unit shows its member count, while the
 * role badge appears only on the unit the viewer holds a direct role on.
 *
 * @summary role badge only where a direct role exists
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    const acmeRow = canvas.getByRole("treeitem", { name: "Acme" });
    await expect(within(acmeRow).getByText("owner")).toBeVisible();
    await expect(within(acmeRow).getByText("5")).toBeVisible();

    const teamARow = canvas.getByRole("treeitem", { name: "Team A" });
    await expect(
      within(teamARow).queryByText(/owner|admin|member|viewer|guest/i),
    ).toBeNull();
    await expect(within(teamARow).getByText("2")).toBeVisible();
  },
};

/**
 * A node's chevron folds its subtree away and unfolds it again.
 *
 * @summary collapsing a node hides its subtree; expanding restores it
 */
export const CollapseSubtree: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("treeitem", { name: "Team C" }),
    ).toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("button", { name: "Collapse Dept B" }),
    );
    await expect(
      canvas.queryByRole("treeitem", { name: "Team C" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("button", { name: "Expand Dept B" }),
    );
    await expect(
      canvas.getByRole("treeitem", { name: "Team C" }),
    ).toBeInTheDocument();
  },
};

/**
 * Enter on a focused row selects it, and the footer breadcrumb follows; Enter
 * on a button inside a row keeps the button's own activation instead of being
 * hijacked into a row select.
 *
 * @summary Enter selects a focused row but never a child button's row
 */
export const KeyboardSelect: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    canvas.getByRole("treeitem", { name: "Team A" }).focus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByText(/Acme\s+›\s+Team A/)).toBeVisible();

    canvas.getByRole("button", { name: "Collapse Dept B" }).focus();
    await userEvent.keyboard("{Enter}");
    // The button's native activation survived: Dept B collapsed…
    await expect(
      canvas.queryByRole("treeitem", { name: "Team C" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Expand Dept B" }),
    ).toBeVisible();
    // …and the row selection did not jump to Dept B.
    await expect(canvas.getByText(/Acme\s+›\s+Team A/)).toBeVisible();
  },
};

/**
 * Deleting a unit that still has children opens an explainer instead of a
 * confirmation: units are deleted leaf-first, and the blocked path never
 * reaches the network.
 *
 * @summary delete on a non-leaf explains instead of deleting
 */
export const DeleteBlockedForNonLeaf: Story = {
  tags: ["ai-generated"],
  beforeEach: stubOrgUnitsFetch,
  play: async ({ canvas }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Delete Dept B" }),
    );

    // The dialog fades in, so wait for it to finish rather than read its
    // first animation frame.
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Can’t delete “Dept B”" }),
      ).toBeVisible(),
    );
    await expect(screen.getByText(/deleted leaf-first/i)).toBeVisible();
    await expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    await expect(fetchMock).not.toHaveBeenCalled();
  },
};

/**
 * Deleting a leaf opens a confirmation naming the unit; confirming sends the
 * DELETE for exactly that unit.
 *
 * @summary delete on a leaf confirms, then sends the delete request
 */
export const DeleteLeaf: Story = {
  tags: ["ai-generated"],
  beforeEach: stubOrgUnitsFetch,
  play: async ({ canvas }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Delete Team A" }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Delete “Team A”?" }),
      ).toBeVisible(),
    );
    await expect(screen.getByText(/removes every membership/i)).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    // The mutation dispatches asynchronously; wait for the request itself.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const request = requestFromCall(fetchMock);
    await expect(request.method).toBe("DELETE");
    await expect(new URL(request.url).pathname).toBe("/api/v1/org-units/teamA");
  },
};

/**
 * The toolbar's Collapse all folds every collapsible row at once, and the
 * same button, now Expand all, restores the whole tree.
 *
 * @summary Collapse all / Expand all toggles every row at once
 */
export const CollapseAll: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("treeitem", { name: "Team C" }),
    ).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Collapse all" }));
    await expect(
      canvas.queryByRole("treeitem", { name: "Team A" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("treeitem", { name: "Team C" }),
    ).not.toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Expand all" }));
    await expect(
      canvas.getByRole("treeitem", { name: "Team A" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("treeitem", { name: "Team C" }),
    ).toBeInTheDocument();
  },
};

/**
 * Add child opens the create dialog scoped to that parent and expands the
 * parent's row, so the unit the dialog creates is visible once it lands;
 * Cancel closes it.
 *
 * @summary Add child opens a scoped create dialog and expands the parent
 */
export const AddChild: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Collapse Dept B" }),
    );
    await expect(
      canvas.queryByRole("treeitem", { name: "Team C" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("button", { name: "Add child unit to Dept B" }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "New unit under “Dept B”" }),
      ).toBeVisible(),
    );
    // The parent row is expanded so the unit the dialog will create is
    // visible once it lands, rather than hidden behind a collapsed chevron.
    // By test id: the open modal hides the tree from the accessibility tree.
    await expect(canvas.getByTestId("org-unit-row-teamC")).toBeInTheDocument();

    await cancelDialog("New unit under “Dept B”");
  },
};

/**
 * A row's Rename action opens the rename dialog for that unit; Cancel closes
 * it.
 *
 * @summary Rename opens the rename dialog for that unit
 */
export const Rename: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Rename Team A" }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Rename “Team A”" }),
      ).toBeVisible(),
    );

    await cancelDialog("Rename “Team A”");
  },
};

/**
 * The move picker never offers the unit itself or its descendants as a new
 * parent, offers making it a root organization, and keeps unrelated units;
 * Cancel closes it.
 *
 * @summary move picker excludes the unit's own subtree
 */
export const MovePicker: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Move Dept B" }));

    const listbox = await screen.findByRole("listbox", { name: "New parent" });
    await waitFor(() => expect(listbox).toBeVisible());
    await expect(
      within(listbox).getByText("— Make root organization —"),
    ).toBeVisible();
    await expect(within(listbox).getByText("Team A")).toBeVisible();
    await expect(within(listbox).getByText("Home Lab")).toBeVisible();
    // Self and its descendant must be absent.
    await expect(within(listbox).queryByText("Dept B")).toBeNull();
    await expect(within(listbox).queryByText("Team C")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(listbox).not.toBeInTheDocument());
  },
};

/**
 * The toolbar's New organization button opens the root create dialog.
 *
 * @summary New organization opens the root create dialog
 */
export const NewOrganization: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "New organization" }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "New organization" }),
      ).toBeVisible(),
    );
    await cancelDialog("New organization");
  },
};

/**
 * The selected-unit footer states the viewer's effective role: direct where
 * the unit carries the membership, inherited (naming its source) below it,
 * and none where no ancestor has one. Manage members stays disabled until the
 * members panel ships.
 *
 * @summary footer shows direct, inherited, or no effective role
 */
export const SelectedUnitFooter: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, step }) => {
    await step("inherited role names its source", async () => {
      await userEvent.click(canvas.getByRole("treeitem", { name: "Team C" }));
      await expect(
        canvas.getByText("Your role here: owner · inherited from Acme"),
      ).toBeVisible();
    });

    await step("no role anywhere in the chain", async () => {
      await userEvent.click(canvas.getByRole("treeitem", { name: "Home Lab" }));
      await expect(
        canvas.getByText("You have no direct role on this unit."),
      ).toBeVisible();
    });

    await step("direct role on the unit itself", async () => {
      await userEvent.click(canvas.getByRole("treeitem", { name: "Acme" }));
      await expect(
        canvas.getByText("Your role here: owner · direct"),
      ).toBeVisible();
    });

    await expect(
      canvas.getByRole("button", { name: /manage members/i }),
    ).toBeDisabled();
  },
};

/**
 * With no units at all, the tree shows the first-run empty state, whose
 * create call to action opens the root create dialog.
 *
 * @summary first-run empty state when there are no units
 */
export const Empty: Story = {
  args: { units: [] },
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No organizations yet")).toBeVisible();
    const create = canvas.getByRole("button", { name: "Create organization" });
    await expect(create).toBeVisible();

    await userEvent.click(create);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "New organization" }),
      ).toBeVisible(),
    );
  },
};
