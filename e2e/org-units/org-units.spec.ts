/**
 * org-units admin UI browser e2e (org-units 4.4, org-admin-ui spec).
 *
 * Walks the whole D6 web surface against the real stack: create a root
 * organization, nest a child unit under it, grant/change/revoke membership
 * for a second account, and prove the last-owner protection (D2) surfaces
 * as the spec's "transfer ownership first" copy rather than a generic
 * error. Uses a `freshAccount` (not the shared worker account) so the
 * empty-state assertion is against a genuinely membership-less caller.
 *
 * This also exercises the `app_rls` provisioning fix in
 * e2e/db-server.ts — without it, `llame_role_on_unit_path` stays owned by
 * `app`, doesn't bypass FORCE RLS, and the roster/effective-role assertions
 * below would see nothing at all (org-units D4).
 */

import { expect, loginViaUi, registerAccount, test } from "../fixtures";

test.describe("org-units admin UI", () => {
  test("create → nest → grant → change role → last-owner block → transfer → leave → rename/move/delete", async ({
    page,
    freshAccount,
    request,
  }) => {
    await page.goto("/login");
    await loginViaUi(page, freshAccount);

    await page.goto("/settings/organizations");

    // Requirement "Organizations overview" — Scenario "First-run empty state".
    await expect(page.getByText("No organizations yet")).toBeVisible();

    const orgName = `E2E Org ${Date.now()}`;
    await page.getByRole("button", { name: "Create organization" }).click();
    await page.getByLabel("Name").fill(orgName);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    const orgRow = page.getByRole("button", { name: orgName, exact: true });
    await expect(orgRow).toBeVisible();
    await expect(page.getByText("No organizations yet")).toHaveCount(0);

    // Create a child unit — Scenario "Visible trees render nested".
    await page.getByRole("button", { name: `Actions for ${orgName}` }).click();
    await page.getByRole("menuitem", { name: "Add child" }).click();

    const teamName = `E2E Team ${Date.now()}`;
    await page.getByLabel("Name").fill(teamName);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    const teamRow = page.getByRole("button", { name: teamName, exact: true });
    await expect(teamRow).toBeVisible();

    // Selecting the child shows the caller's role as INHERITED from the root.
    await teamRow.click();
    await expect(
      page.getByText(`Your role here: Owner (inherited from ${orgName})`),
    ).toBeVisible();

    // Selecting the root itself shows a direct (non-inherited) Owner role.
    await orgRow.click();
    await expect(page.getByText("Your role here: Owner")).toBeVisible();

    const selfRow = page.getByTestId(`membership-row-${freshAccount.id}`);
    await expect(selfRow).toBeVisible();

    // A second account to grant/manage — registered via the auth API only,
    // no browser session needed for this test.
    const orgMate = await registerAccount(
      request,
      "org-mate",
      test.info().parallelIndex,
    );

    // Requirement "Members panel" — Scenario "Grant from the panel".
    await page.getByLabel("User ID").fill(orgMate.id);
    await page.getByRole("button", { name: "Grant", exact: true }).click();

    const mateRow = page.getByTestId(`membership-row-${orgMate.id}`);
    await expect(mateRow).toBeVisible();
    await expect(mateRow.getByRole("button", { name: "Member" })).toBeVisible();

    // Domain error semantics — re-granting the same user 409s as "already a
    // member", surfaced inline next to the grant form.
    await page.getByLabel("User ID").fill(orgMate.id);
    await page.getByRole("button", { name: "Grant", exact: true }).click();
    await expect(page.getByText("Already a member.")).toBeVisible();

    // Change role: Member -> Admin (no confirmation required, non-owner).
    await mateRow.getByRole("button", { name: "Member" }).click();
    await page.getByRole("menuitemradio", { name: "Admin" }).click();
    await expect(mateRow.getByRole("button", { name: "Admin" })).toBeVisible();

    // Requirement "Domain error semantics" — Scenario "Last-owner conflict":
    // the caller is still the SOLE owner (org-mate is only admin) — leaving
    // must be blocked with the transfer-first copy, not a generic error.
    await selfRow.getByRole("button", { name: "Leave" }).click();
    const leaveDialog = page.getByRole("alertdialog");
    await leaveDialog
      .getByRole("button", { name: "Leave", exact: true })
      .click();
    await expect(
      leaveDialog.getByText(/transfer ownership first/i),
    ).toBeVisible();
    await leaveDialog.getByRole("button", { name: "Cancel" }).click();

    // Rename/move/delete the team unit WHILE still a member of the root —
    // the caller's admin-tier on the child is inherited from their root
    // membership (createChildOrg grants no membership on the child itself),
    // so these must run before self-leave below, which revokes that
    // inheritance.
    const teamRenamed = `${teamName} Renamed`;
    await page.getByRole("button", { name: `Actions for ${teamName}` }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByLabel("Name").fill(teamRenamed);
    await page.getByRole("button", { name: "Save" }).click();

    const renamedRow = page.getByRole("button", {
      name: teamRenamed,
      exact: true,
    });
    await expect(renamedRow).toBeVisible();

    // A sibling unit to move the team under — Requirement "Unit management
    // actions". "Move to root" needs admin/owner-tier ON THE UNIT ITSELF
    // (D5: it loses the parent's inherited tier the instant it becomes a
    // standalone root), which this caller never has here (createChildOrg
    // grants no membership on the child it creates) — moving it to ANOTHER
    // unit under the same tree stays covered by the inherited root role on
    // both the old and new path, so that's what's exercised here.
    await page.getByRole("button", { name: `Actions for ${orgName}` }).click();
    await page.getByRole("menuitem", { name: "Add child" }).click();
    const siblingName = `E2E Sibling ${Date.now()}`;
    await page.getByLabel("Name").fill(siblingName);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(
      page.getByRole("button", { name: siblingName, exact: true }),
    ).toBeVisible();

    // Move the (renamed) team under the sibling — asserted via the row's own
    // indentation increasing by one level (depth 1 -> depth 2); depth is a
    // computed layout value, not something exposed as text.
    await expect(renamedRow).toHaveCSS("padding-left", "28px");
    await page
      .getByRole("button", { name: `Actions for ${teamRenamed}` })
      .click();
    await page.getByRole("menuitem", { name: "Move" }).click();
    const moveDialog = page.getByRole("dialog");
    await moveDialog.getByText(siblingName, { exact: true }).click();
    await moveDialog.getByRole("button", { name: "Move", exact: true }).click();
    await expect(renamedRow).toHaveCSS("padding-left", "48px");

    // Delete — Scenario "Delete requires confirmation": names the unit and
    // states memberships are removed, before any request is sent.
    await page
      .getByRole("button", { name: `Actions for ${teamRenamed}` })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const deleteDialog = page.getByRole("alertdialog");
    await expect(deleteDialog.getByText(teamRenamed)).toBeVisible();
    await expect(
      deleteDialog.getByText(/removes every membership/i),
    ).toBeVisible();
    await deleteDialog
      .getByRole("button", { name: "Delete", exact: true })
      .click();

    await expect(renamedRow).toHaveCount(0);

    // Transfer ownership: promote org-mate to Owner (ownership-affecting —
    // requires the "Make owner?" confirmation).
    await orgRow.click();
    await mateRow.getByRole("button", { name: "Admin" }).click();
    await page.getByRole("menuitemradio", { name: "Owner" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Make owner" })
      .click();
    await expect(mateRow.getByRole("button", { name: "Owner" })).toBeVisible();

    // Now that a co-owner exists, self-leave succeeds.
    await selfRow.getByRole("button", { name: "Leave" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Leave", exact: true })
      .click();
    await expect(selfRow).toHaveCount(0);
  });
});
