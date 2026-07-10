/**
 * Tool-calling loop end-to-end browser proof
 * (openspec/changes/tool-calling-loop).
 *
 * The whole stack: the mock model emits an OpenAI-compatible tool call → the
 * api's real AI SDK tool loop executes `search_conversations` (D7's ONE
 * shipped tool: own-data, read-only, real DB search — see e2e/model-server.ts)
 * → run_events persist the tool parts (`type: "tool-search_conversations"`)
 * → the stream bridge translates them to UI parts → useChat parses them →
 * `ToolCallPart` renders. The render path is the seam the unit/integration
 * tests couldn't reach; this is the positive-path eval (agent uses the tool
 * and answers), a mid-run refresh proof, and a historical-reload parity
 * proof (design.md D5: "same part types render live and historical paths").
 *
 * Note on "mid-tool-execution" precision: the real tool's execute() is a
 * fast in-process DB query, so there's no reliable window to catch the
 * `input-available` ("running…") state specifically with a browser reload —
 * that would need a server-side test hook in apps/api, out of this task's
 * scope. What IS proven here is the broader guarantee the spec's "Tool
 * activity survives refresh" requirement actually cares about: a refresh
 * mid-run reconstructs already-completed tool call/result parts from
 * persisted state (not re-executed, not lost) while the run's answer keeps
 * streaming — the same replay path a reload during actual tool execution
 * would exercise.
 *
 * The mock's tool branch is triple-gated (tools present + user says "search"
 * + no prior tool result), so only tests here trigger it.
 *
 * Step-cap notice rendering (D6, the `data-cap-notice` part) is NOT covered
 * here: forcing 8 tool-requesting turns deterministically through the mock
 * would be a disproportionate amount of e2e scaffolding for what the cap
 * chip actually needs proven (that it renders, identically live and from
 * history) — that's covered by a component test instead
 * (tool-cap-notice-part.test.tsx), consistent with the task's documented
 * fallback for an impractical-to-seed e2e scenario.
 */

import { expect, test } from "../fixtures";

const TOOL_ANSWER = "Here are the past conversations I found.";

test.describe("tool-calling loop (browser, full stack)", () => {
  test("the agent calls search_conversations and its use is visible in chat", async ({
    page,
  }) => {
    await page.goto("/");

    await page
      .getByPlaceholder("What would you like to know?")
      .fill("please search my past conversations for budget notes");
    await page.getByRole("button", { name: "Send message" }).click();

    const log = page.getByRole("log");

    // The tool use is VISIBLE: the ToolCallPart chip shows the tool name
    // (present in the DOM through call → running → result — one element
    // updated in place, not swapped, per design.md D5's "one renderer").
    await expect(log.getByText("search_conversations")).toBeVisible({
      timeout: 20_000,
    });

    // The tool resolved (state reached output-available): the chip's badge
    // reads "done".
    await expect(log.getByText("done")).toBeVisible({ timeout: 20_000 });

    // The follow-up answer (second turn, after the tool result reached the
    // model) streams in.
    await expect(log.getByText(TOOL_ANSWER)).toBeVisible({ timeout: 20_000 });
  });

  test("refresh mid-run reconstructs the completed tool activity and the run keeps streaming", async ({
    page,
  }) => {
    await page.goto("/");

    // "SLOW" makes the mock drip the FOLLOW-UP answer's tokens (~4s) once
    // the tool result is back — the tool call/result themselves resolve
    // immediately (a real but fast DB query), so by the time we reload the
    // tool part is already persisted as done and the answer is still
    // streaming: exactly the "already-completed tool activity + still-live
    // run" state a mid-tool-execution reload would also need to reconstruct.
    await page
      .getByPlaceholder("What would you like to know?")
      .fill("SLOW please search my past conversations for budget notes");
    await page.getByRole("button", { name: "Send message" }).click();

    const log = page.getByRole("log");

    // Wait for the tool activity to resolve, then for the first token of the
    // slow-dripping follow-up answer — confirms we're mid-run, not
    // post-completion, before reloading.
    await expect(log.getByText("done")).toBeVisible({ timeout: 20_000 });
    await expect(log.getByText("Here", { exact: false })).toBeVisible({
      timeout: 20_000,
    });

    await page.reload();

    // Reconstructed from the persisted run: the tool activity survived the
    // refresh (still shows as done, not re-executed/re-triggered — no
    // second "search_conversations" chip appears), and the answer completes.
    await expect(log.getByText("search_conversations")).toHaveCount(1);
    await expect(log.getByText("done")).toBeVisible({ timeout: 10_000 });
    await expect(log.getByText(TOOL_ANSWER)).toBeVisible({ timeout: 25_000 });
  });

  test("reloading the chat from history renders the tool activity identically", async ({
    page,
  }) => {
    await page.goto("/");

    await page
      .getByPlaceholder("What would you like to know?")
      .fill("please search my past conversations for budget notes");
    await page.getByRole("button", { name: "Send message" }).click();

    const log = page.getByRole("log");
    await expect(log.getByText(TOOL_ANSWER)).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 15_000 });

    // A full reload re-fetches history (GET :id/messages) instead of
    // replaying the live stream — the persisted `tool-search_conversations`
    // part must render through the exact same ToolCallPart, not a
    // degraded/placeholder view.
    await page.reload();

    await expect(log.getByText("search_conversations")).toBeVisible({
      timeout: 15_000,
    });
    await expect(log.getByText("done")).toBeVisible({ timeout: 15_000 });
    await expect(log.getByText(TOOL_ANSWER)).toBeVisible({ timeout: 15_000 });
  });
});
