/**
 * Host bash browser acceptance (openspec/changes/host-bash-context task 3.3).
 *
 * The mock model requests bash only for the unique marker below. The real api
 * then admits the host tool, executes a command that prints an absolute path,
 * and renders its non-zero exit as the ordinary tool error panel.
 */

import { expect, test } from "../../support/fixtures";

const BASH_PROMPT =
  "Please run the host bash output fidelity e2e fixture for this chat.";
const BASH_OUTPUT_PATH = "/tmp/llame-e2e-bash-output";
const E2E_MODEL_ID = "system:openai:gpt-5.4-mini";

test("renders host bash output and a non-zero exit code", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("combobox", { name: "Select model" }),
  ).toContainText(E2E_MODEL_ID);

  const composer = page.getByPlaceholder("What would you like to know?");
  await expect(composer).toBeEditable();
  await composer.fill(BASH_PROMPT);
  await page.getByRole("button", { name: "Send message" }).click();

  const log = page.getByRole("log");
  const bashCard = log
    .getByRole("button")
    .filter({ hasText: /^bash/u })
    .first();
  await expect(bashCard).toContainText("Error", { timeout: 30_000 });

  await bashCard.click();
  const details = bashCard.locator("..");
  const errorPanel = details
    .locator("h4")
    .filter({ hasText: "Error" })
    .locator("..");
  await expect(errorPanel).toContainText(`stdout:\n${BASH_OUTPUT_PATH}`);
  await expect(errorPanel).toContainText("Command exited with code 7.");
});
