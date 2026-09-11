/**
 * Operator tool-call permission browser acceptance
 * (openspec/changes/tool-call-permissions task 2.9).
 *
 * The mock model asks for a Bash command the e2e policy rejects, then for an
 * allowed native read. The rejected call renders a non-fatal `permission_denied`
 * tool error, the Run completes without stopping, and the private decision
 * record survives a reload of the Chat.
 */

import { expect, test } from "../../support/fixtures";

const PERMISSION_PROMPT =
  "Please demonstrate the permission rejection e2e fixture for this chat.";
const E2E_MODEL_ID = "system:openai:gpt-5.4-mini";

test("rejects a Bash call, continues with an allowed read, and persists the decision", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("combobox", { name: "Select model" }),
  ).toContainText(E2E_MODEL_ID);

  const composer = page.getByPlaceholder("What would you like to know?");
  await expect(composer).toBeEditable();
  await composer.fill(PERMISSION_PROMPT);
  await page.getByRole("button", { name: "Send message" }).click();

  const log = page.getByRole("log");
  const bashCard = log
    .getByRole("button")
    .filter({ hasText: /^bash/u })
    .first();
  await expect(bashCard).toContainText("Error", { timeout: 30_000 });
  await bashCard.click();
  await expect(bashCard.locator("..")).toContainText(
    "rejected before execution by operator permissions",
  );

  // The rejected call does not stop the Run: the allowed read still executes.
  const readCard = log
    .getByRole("button")
    .filter({ hasText: /^read/u })
    .first();
  await expect(readCard).toBeVisible({ timeout: 30_000 });
  await expect(log).toContainText("read continued.", { timeout: 30_000 });

  // Reopening the Chat reconstructs the tool activity from persisted parts,
  // with the rejection still present.
  await page.reload({ waitUntil: "domcontentloaded" });
  const reloadedBash = page
    .getByRole("log")
    .getByRole("button")
    .filter({ hasText: /^bash/u })
    .first();
  await expect(reloadedBash).toContainText("Error", { timeout: 30_000 });
  await reloadedBash.click();
  await expect(reloadedBash.locator("..")).toContainText(
    "rejected before execution by operator permissions",
  );
});
