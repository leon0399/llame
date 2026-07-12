/**
 * org-units admin UI browser e2e (org-units 4.4, org-admin-ui spec).
 *
 * Walks the LIVE web surface against the real stack: the settings→admin
 * redirect, the first-run empty state, create a root organization, nest a
 * child unit under it, rename it, move it under a sibling, and delete it.
 * Uses a `freshAccount` (not the shared worker account) so the empty-state
 * assertion is against a genuinely membership-less caller.
 *
 * Updated for the tree redesign (admin-area-org-tree change, tasks.md
 * section 3–4): the old flat-indented tree's per-row "Actions for X"
 * dropdown menu is gone — each row now exposes add-child/rename/move/delete
 * as hover-revealed buttons directly on the row (`Add child unit to X` /
 * `Rename X` / `Move X` / `Delete X`), and depth is asserted via each row's
 * `aria-level` (ARIA treeitem, 1-based) instead of a computed
 * `padding-left` — that CSS assertion belonged to the old flat list, not
 * the real nested tree. Also re-adds the selected-unit footer's
 * effective-role assertions (direct vs. inherited), which the redesign
 * (task 3.3) makes live again.
 *
 * NOTE (admin-area-org-tree change, D7 — accepted temporary regression): the
 * Members panel (grant/change-role/revoke/leave, the last-owner-transfer
 * flow) is NOT rendered on `/admin/organizations` in this change — it's
 * parked unwired pending the members-panel fast-follow, which re-adds that
 * coverage. Do not re-add those assertions here until that panel is wired
 * back in. The footer's "Manage members" button here is a disabled
 * placeholder only.
 */

import { expect, loginViaUi, test } from "../fixtures";

test.describe("org-units admin UI", () => {
  test("redirect → create → nest → rename → move → delete", async ({
    page,
    freshAccount,
  }) => {
    // Every Dialog/AlertDialog content in @workspace/ui carries a CSS exit
    // animation driven by Radix's data-state attribute (dialog.tsx,
    // alert-dialog.tsx both use `data-[state=closed]:animate-out`). Radix
    // keeps the closing element's role intact while it fades out, so a
    // still-animating-out surface (e.g. a create dialog whose close hasn't
    // finished) can transiently coexist in the DOM with the next one this
    // test opens — an unscoped getByRole/getByLabel can then resolve to both
    // and hit Playwright's strict-mode violation. These helpers scope every
    // such interaction to the currently OPEN instance specifically (not just
    // "a dialog"), which stays correct even if a closing sibling briefly
    // lingers.
    const openDialog = () => page.locator('[role="dialog"][data-state="open"]');
    const openAlertDialog = () =>
      page.locator('[role="alertdialog"][data-state="open"]');

    const row = (name: string) =>
      page.getByRole("treeitem", { name, exact: true });

    await page.goto("/login");
    await loginViaUi(page, freshAccount);

    await page.goto("/settings/organizations");

    // org-admin-ui spec "Former settings route redirects".
    await expect(page).toHaveURL(/\/admin\/organizations$/);

    // Requirement "Organizations overview" — Scenario "First-run empty state".
    await expect(page.getByText("No organizations yet")).toBeVisible();

    const orgName = `E2E Org ${Date.now()}`;
    await page.getByRole("button", { name: "Create organization" }).click();
    await openDialog().getByLabel("Name").fill(orgName);
    await openDialog()
      .getByRole("button", { name: "Create", exact: true })
      .click();

    const orgRow = row(orgName);
    await expect(orgRow).toBeVisible();
    await expect(page.getByText("No organizations yet")).toHaveCount(0);
    // A fresh root organization is depth 0 (aria-level 1).
    await expect(orgRow).toHaveAttribute("aria-level", "1");

    // Selecting it surfaces the footer with a DIRECT owner role (root
    // bootstrap grants the creator `owner` on their new organization) —
    // Scenario "Node surfaces membership at a glance".
    await orgRow.click();
    await expect(
      page.getByText("Your role here: owner · direct"),
    ).toBeVisible();

    // Create a child unit — Scenario "Tree renders with real hierarchy affordances".
    await page
      .getByRole("button", { name: `Add child unit to ${orgName}` })
      .click();

    const teamName = `E2E Team ${Date.now()}`;
    await openDialog().getByLabel("Name").fill(teamName);
    await openDialog()
      .getByRole("button", { name: "Create", exact: true })
      .click();

    const teamRow = row(teamName);
    await expect(teamRow).toBeVisible();
    await expect(teamRow).toHaveAttribute("aria-level", "2");

    // Selecting the child surfaces an INHERITED role, from the parent org.
    await teamRow.click();
    await expect(
      page.getByText(`Your role here: owner · inherited from ${orgName}`),
    ).toBeVisible();

    // Rename — Requirement "Unit management actions".
    const teamRenamed = `${teamName} Renamed`;
    await page.getByRole("button", { name: `Rename ${teamName}` }).click();
    await openDialog().getByLabel("Name").fill(teamRenamed);
    await openDialog().getByRole("button", { name: "Save" }).click();

    const renamedRow = row(teamRenamed);
    await expect(renamedRow).toBeVisible();

    // A sibling unit to move the team under.
    await page
      .getByRole("button", { name: `Add child unit to ${orgName}` })
      .click();
    const siblingName = `E2E Sibling ${Date.now()}`;
    await openDialog().getByLabel("Name").fill(siblingName);
    await openDialog()
      .getByRole("button", { name: "Create", exact: true })
      .click();
    await expect(row(siblingName)).toBeVisible();

    // Move the (renamed) team under the sibling — asserted via the row's
    // own `aria-level` moving one level deeper (2 -> 3), the real-tree
    // replacement for the old flat list's computed `padding-left`.
    await expect(renamedRow).toHaveAttribute("aria-level", "2");
    await page.getByRole("button", { name: `Move ${teamRenamed}` }).click();
    await openDialog()
      .getByRole("option", { name: siblingName, exact: true })
      .click();
    await openDialog()
      .getByRole("button", { name: "Move", exact: true })
      .click();
    await expect(renamedRow).toHaveAttribute("aria-level", "3");

    // Delete on a NON-leaf (the sibling, now parent of the moved team) is
    // explained, not attempted — Scenario "Delete on a non-leaf is
    // explained, not attempted".
    await page.getByRole("button", { name: `Delete ${siblingName}` }).click();
    await expect(
      page.getByRole("heading", { name: `Can’t delete “${siblingName}”` }),
    ).toBeVisible();
    await expect(page.getByText(/deleted leaf-first/i)).toBeVisible();
    await page.getByRole("button", { name: "Got it" }).click();
    // No request was sent — the sibling and its child are both still there.
    await expect(row(siblingName)).toBeVisible();
    await expect(renamedRow).toBeVisible();

    // Delete the (leaf) team — Scenario "Delete requires confirmation": names
    // the unit and states memberships are removed, before any request is sent.
    await page.getByRole("button", { name: `Delete ${teamRenamed}` }).click();
    // Both the title and the description repeat the unit name — assert the
    // title specifically (spec: the confirmation names the unit).
    await expect(
      openAlertDialog().getByRole("heading", { name: teamRenamed }),
    ).toBeVisible();
    await expect(
      openAlertDialog().getByText(/removes every membership/i),
    ).toBeVisible();
    await openAlertDialog()
      .getByRole("button", { name: "Delete", exact: true })
      .click();

    await expect(renamedRow).toHaveCount(0);
  });
});
