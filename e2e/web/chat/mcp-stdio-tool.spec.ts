/**
 * Local stdio MCP browser acceptance
 * (openspec/changes/add-stdio-mcp-servers task 4.10).
 *
 * The deterministic model requests the stdio fixture's namespaced tool only for
 * STDIO_PROMPT. This is the one test that exercises the whole chain in real
 * processes: the config loader resolves an interpolated secret into the entry's
 * protected values, the runtime spawns the child, the client speaks JSON-RPC
 * over its pipes, and the answer is persisted and replayed.
 *
 * It also asserts the secret's absence. The fixture writes it to stderr and
 * returns it inside its tool result, so a redaction regression on either
 * channel surfaces here rather than in an operator's logs.
 */

import { expect, test } from "../../support/fixtures";

const STDIO_PROMPT =
  "Please look up the local stdio fixture evidence for this deterministic run.";
const FIXTURE_ANSWER =
  "Local stdio evidence: deterministic local MCP lookup succeeded.";
const STDIO_SECRET = process.env.E2E_STDIO_MCP_SECRET ?? "stdio-e2e-secret";

test("local stdio MCP tool settles, redacts its secret, and replays from history", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const composer = page.getByPlaceholder("What would you like to know?");
  await expect(composer).toBeEditable();
  await composer.fill(STDIO_PROMPT);
  const send = page.getByRole("button", { name: "Send message" });
  await expect(send).toBeEnabled();
  await send.click();

  const log = page.getByRole("log");
  const settledToolActivities = log
    .getByRole("button")
    .filter({ hasText: "Completed" });

  // The tool ran through the ordinary renderer — there is no stdio-specific UI.
  await expect(settledToolActivities).toHaveCount(1, { timeout: 30_000 });
  await expect(log.getByText(FIXTURE_ANSWER)).toBeVisible({ timeout: 30_000 });

  // The fixture returns the secret inside its tool result, so a redaction
  // regression on the result path surfaces here.
  await expect(page.locator("body")).not.toContainText(STDIO_SECRET);

  // A full reload reconstructs the persisted activity and answer without
  // re-running the child process.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(log.getByText(FIXTURE_ANSWER)).toBeVisible({ timeout: 30_000 });
  await expect(settledToolActivities).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText(STDIO_SECRET);
});
