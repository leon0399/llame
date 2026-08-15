/**
 * Operator-configured MCP browser acceptance
 * (openspec/changes/add-streamable-http-mcp-tools task 4.5).
 *
 * The deterministic model requests the fixture's namespaced search tool only
 * for MCP_SEARCH_PROMPT. The browser intentionally asserts the ordinary Tool
 * renderer rather than an MCP-specific component. A fixture-side call counter
 * proves that a full history reload reconstructs the persisted activity and
 * answer without executing the remote tool again.
 */

import { expect, test } from "../../support/fixtures";

const MCP_SEARCH_PROMPT =
  "Please search for the current deterministic operator MCP fixture evidence.";
const FIXTURE_ANSWER =
  "Current fixture evidence: deterministic operator MCP search succeeded.";
const FIXTURE_SOURCE_URL = "https://fixture.invalid/operator-mcp/current";
const E2E_MODEL_ID = "system:openai:gpt-5.4-mini";
const mcpFixtureUrl = `http://localhost:${process.env.E2E_MCP_PORT ?? "4304"}`;

type McpFixtureStats = {
  toolCalls: number;
  sessionBoundRequests: number;
};

test("operator MCP search settles and reconstructs from durable chat history", async ({
  page,
  request,
}) => {
  const baseline = await request.get(`${mcpFixtureUrl}/stats`);
  expect(baseline.ok()).toBe(true);
  const baselineStats = (await baseline.json()) as McpFixtureStats;

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("combobox", { name: "Select model" }),
  ).toContainText(E2E_MODEL_ID);
  const composer = page.getByPlaceholder("What would you like to know?");
  await expect(composer).toBeEditable();
  await composer.fill(MCP_SEARCH_PROMPT);
  const send = page.getByRole("button", { name: "Send message" });
  await expect(send).toBeEnabled();
  await send.click();

  const log = page.getByRole("log");
  const settledToolActivities = log
    .getByRole("button")
    .filter({ hasText: "Completed" });

  await expect(settledToolActivities).toHaveCount(1, { timeout: 20_000 });
  await expect(log.getByText(FIXTURE_ANSWER)).toBeVisible({ timeout: 20_000 });
  // The modal is rendered inside the streamed message tree. Wait for the run
  // to settle before interacting with it so the close button cannot be
  // replaced by a final stream update between Playwright's actionability
  // check and click.
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible({
    timeout: 15_000,
  });
  const fixtureSource = log.getByRole("button", { name: "Fixture source" });
  const linkSafetyModal = page.locator('[data-streamdown="link-safety-modal"]');
  await expect(fixtureSource).toBeVisible();
  await fixtureSource.click();
  await expect(
    linkSafetyModal.getByText(FIXTURE_SOURCE_URL, { exact: true }),
  ).toBeVisible();
  await linkSafetyModal.getByRole("button", { name: "Close" }).click();
  await expect(linkSafetyModal).toBeHidden();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 15_000 });

  await expect
    .poll(async () => {
      const response = await request.get(`${mcpFixtureUrl}/stats`);
      const stats = (await response.json()) as McpFixtureStats;
      return stats.toolCalls;
    })
    .toBe(baselineStats.toolCalls + 1);

  const afterTool = await request.get(`${mcpFixtureUrl}/stats`);
  expect(afterTool.ok()).toBe(true);
  const afterToolStats = (await afterTool.json()) as McpFixtureStats;
  expect(afterToolStats.sessionBoundRequests).toBeGreaterThan(
    baselineStats.sessionBoundRequests,
  );

  await page.reload();

  await expect(settledToolActivities).toHaveCount(1, { timeout: 15_000 });
  await expect(log.getByText(FIXTURE_ANSWER)).toBeVisible({ timeout: 15_000 });
  await expect(fixtureSource).toBeVisible();
  await fixtureSource.click();
  await expect(
    linkSafetyModal.getByText(FIXTURE_SOURCE_URL, { exact: true }),
  ).toBeVisible();
  await linkSafetyModal.getByRole("button", { name: "Close" }).click();
  await expect(linkSafetyModal).toBeHidden();

  const afterReload = await request.get(`${mcpFixtureUrl}/stats`);
  expect(afterReload.ok()).toBe(true);
  const afterReloadStats = (await afterReload.json()) as McpFixtureStats;
  expect(afterReloadStats.toolCalls).toBe(baselineStats.toolCalls + 1);
  expect(afterReloadStats.sessionBoundRequests).toBe(
    afterToolStats.sessionBoundRequests,
  );
});
