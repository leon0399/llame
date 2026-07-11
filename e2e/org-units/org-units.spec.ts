/**
 * org-units admin UI browser e2e (org-units 4.4, org-admin-ui spec).
 *
 * Walks the LIVE web surface against the real stack: the settings→admin
 * redirect, the first-run empty state, create a root organization, nest a
 * child unit under it, rename it, move it under a sibling, and delete it.
 * Uses a `freshAccount` (not the shared worker account) so the empty-state
 * assertion is against a genuinely membership-less caller.
 *
 * NOTE (admin-area-org-tree change, D7 — accepted temporary regression): the
 * Members panel (grant/change-role/revoke/leave, the "Your role here…" copy,
 * the last-owner-transfer flow) is NOT rendered on `/admin/organizations` in
 * this change — it's parked unwired pending the members-panel fast-follow,
 * which re-adds this coverage. Do not re-add those assertions here until
 * that panel is wired back in.
 */

import { expect, loginViaUi, test } from "../fixtures";

test.describe("org-units admin UI", () => {
  test("redirect → create → nest → rename → move → delete", async ({
    page,
    freshAccount,
  }) => {
    // Every Dialog/AlertDialog/DropdownMenu content in @workspace/ui carries
    // a CSS exit animation driven by Radix's data-state attribute (dialog.tsx,
    // alert-dialog.tsx, dropdown-menu.tsx all use `data-[state=closed]:animate-out`).
    // Radix keeps the closing element's role intact while it fades out, so a
    // still-animating-out surface (e.g. a create dialog whose close hasn't
    // finished) can transiently coexist in the DOM with the next one this
    // test opens — an unscoped getByRole/getByLabel can then resolve to both
    // and hit Playwright's strict-mode violation. These helpers scope every
    // such interaction to the currently OPEN instance specifically (not just
    // "a dialog" or "a menu"), which stays correct even if a closing sibling
    // briefly lingers.
    const openDialog = () => page.locator('[role="dialog"][data-state="open"]');
    const openAlertDialog = () =>
      page.locator('[role="alertdialog"][data-state="open"]');
    const openMenu = () => page.locator('[role="menu"][data-state="open"]');

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

    const orgRow = page.getByRole("button", { name: orgName, exact: true });
    await expect(orgRow).toBeVisible();
    await expect(page.getByText("No organizations yet")).toHaveCount(0);

    // Create a child unit — Scenario "Visible trees render nested".
    await page.getByRole("button", { name: `Actions for ${orgName}` }).click();
    await openMenu().getByRole("menuitem", { name: "Add child" }).click();

    const teamName = `E2E Team ${Date.now()}`;
    await openDialog().getByLabel("Name").fill(teamName);
    await openDialog()
      .getByRole("button", { name: "Create", exact: true })
      .click();

    const teamRow = page.getByRole("button", { name: teamName, exact: true });
    await expect(teamRow).toBeVisible();

    // Rename — Requirement "Unit management actions".
    const teamRenamed = `${teamName} Renamed`;
    await page.getByRole("button", { name: `Actions for ${teamName}` }).click();
    await openMenu().getByRole("menuitem", { name: "Rename" }).click();
    await openDialog().getByLabel("Name").fill(teamRenamed);
    await openDialog().getByRole("button", { name: "Save" }).click();

    const renamedRow = page.getByRole("button", {
      name: teamRenamed,
      exact: true,
    });
    await expect(renamedRow).toBeVisible();

    // A sibling unit to move the team under.
    await page.getByRole("button", { name: `Actions for ${orgName}` }).click();
    await openMenu().getByRole("menuitem", { name: "Add child" }).click();
    const siblingName = `E2E Sibling ${Date.now()}`;
    await openDialog().getByLabel("Name").fill(siblingName);
    await openDialog()
      .getByRole("button", { name: "Create", exact: true })
      .click();
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
    await openMenu().getByRole("menuitem", { name: "Move" }).click();
    await openDialog().getByText(siblingName, { exact: true }).click();
    await openDialog()
      .getByRole("button", { name: "Move", exact: true })
      .click();
    await expect(renamedRow).toHaveCSS("padding-left", "48px");

    // Delete — Scenario "Delete requires confirmation": names the unit and
    // states memberships are removed, before any request is sent.
    await page
      .getByRole("button", { name: `Actions for ${teamRenamed}` })
      .click();
    await openMenu().getByRole("menuitem", { name: "Delete" }).click();
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
