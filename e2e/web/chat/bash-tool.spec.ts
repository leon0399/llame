/**
 * Host bash browser acceptance (openspec/changes/host-bash-context task 3.3).
 *
 * The mock model requests bash only for the unique marker below. The real api
 * then admits the host tool, executes a command that prints an absolute path,
 * and renders its non-zero exit with the command's terminal output and details.
 */

import { readyComposer } from "../../support/composer";
import { expect, test } from "../../support/fixtures";

const BASH_PROMPT =
  "Please run the host bash output fidelity e2e fixture for this chat.";

const BASH_OUTPUT_PATH = "/tmp/llame-e2e-bash-output";

test("renders host bash output and a non-zero exit code", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const composer = await readyComposer(page);
  await composer.fill(BASH_PROMPT);
  await page.getByRole("button", { name: "Send message" }).click();

  const log = page.getByRole("log");

  const bashCard = log
    .getByRole("button")
    .filter({ hasText: /\bbash, /u })
    .first();

  await expect(bashCard).toContainText("Error", { timeout: 30_000 });

  await bashCard.click();
  const details = bashCard.locator("..");

  const terminal = details.getByLabel("Command and standard output");

  const stdout = await terminal.locator("code").evaluate((code) =>
    Array.from(code.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(""),
  );

  expect(stdout).toBe(`${BASH_OUTPUT_PATH}\n`);
  await expect(
    details.getByText("Exit code:", { exact: true }).locator(".."),
  ).toHaveText(/Exit code:\s*7/u);
});
