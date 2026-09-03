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

import { expect, test, type APIResponse } from "../../support/fixtures";

const MCP_SEARCH_PROMPT =
  "Please search for the current deterministic operator MCP fixture evidence.";
const FIXTURE_ANSWER =
  "Current fixture evidence: deterministic operator MCP search succeeded.";
const FIXTURE_SOURCE_URL = "https://fixture.invalid/operator-mcp/current";
const E2E_MODEL_ID = "system:openai:gpt-5.4-mini";
const mcpFixtureUrl = `http://localhost:${process.env.E2E_MCP_PORT ?? "4304"}`;
const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;
const apiOrigin = new URL(apiUrl).origin;

type McpFixtureStats = {
  toolCalls: number;
  sessionBoundRequests: number;
};

async function readMcpStats(response: APIResponse): Promise<McpFixtureStats> {
  // SAFETY: this is our own e2e MCP fixture's /stats endpoint
  // (e2e/support/mcp-server.ts's sendJson({ toolCalls, sessionBoundRequests
  // })); the shape is fixed by that source, not external input.
  return (await response.json()) as McpFixtureStats;
}

test("operator MCP search settles and reconstructs from durable chat history", async ({
  page,
  request,
}) => {
  const baseline = await request.get(`${mcpFixtureUrl}/stats`);
  expect(baseline.ok()).toBe(true);
  const baselineStats = await readMcpStats(baseline);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}\?draft=fresh$/, {
    timeout: 15_000,
  });

  const chatId = new URL(page.url()).pathname.split("/").pop();
  if (!chatId) {
    throw new Error(`Could not extract chat id from URL: ${page.url()}`);
  }

  let releaseHistory: () => void = () => undefined;
  const historyRelease = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  let markHistoryReachedApi: () => void = () => undefined;
  let historyStatus: number | undefined;
  const historyReachedApi = new Promise<void>((resolve) => {
    markHistoryReachedApi = resolve;
  });
  let markHistoryCommitted: () => void = () => undefined;
  const historyCommitted = new Promise<void>((resolve) => {
    markHistoryCommitted = resolve;
  });

  await page.route(
    (url) =>
      url.origin === apiOrigin &&
      url.pathname === `/api/v1/chats/${chatId}/messages` &&
      url.searchParams.has("limit"),
    async (route) => {
      const response = await route.fetch();
      historyStatus = response.status();
      markHistoryReachedApi();
      await historyRelease;
      await route.fulfill({ response });
      markHistoryCommitted();
    },
    { times: 1 },
  );

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
  await historyReachedApi;
  expect(historyStatus, "owner history response status").toBe(200);
  const fixtureSource = log.getByRole("button", { name: "Fixture source" });
  const linkSafetyModal = page.locator('[data-streamdown="link-safety-modal"]');
  await expect(fixtureSource).toBeVisible();
  await fixtureSource.click();
  await expect(
    linkSafetyModal.getByText(FIXTURE_SOURCE_URL, { exact: true }),
  ).toBeVisible();
  releaseHistory();
  await historyCommitted;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expect(linkSafetyModal).toBeVisible();
  await linkSafetyModal.getByRole("button", { name: "Close" }).click();
  await expect(linkSafetyModal).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/chat/${chatId}$`), {
    timeout: 15_000,
  });

  await expect
    .poll(async () => {
      const response = await request.get(`${mcpFixtureUrl}/stats`);
      const stats = await readMcpStats(response);
      return stats.toolCalls;
    })
    .toBe(baselineStats.toolCalls + 1);

  const afterTool = await request.get(`${mcpFixtureUrl}/stats`);
  expect(afterTool.ok()).toBe(true);
  const afterToolStats = await readMcpStats(afterTool);
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
  const afterReloadStats = await readMcpStats(afterReload);
  expect(afterReloadStats.toolCalls).toBe(baselineStats.toolCalls + 1);
  expect(afterReloadStats.sessionBoundRequests).toBe(
    afterToolStats.sessionBoundRequests,
  );
});
