/**
 * Tool-calling loop end-to-end browser proof.
 *
 * The whole stack: the mock model emits an OpenAI-compatible tool call → the
 * api's real AI SDK tool loop executes get_current_time (policy pre-filtered,
 * step-bounded) → run_events persist → the stream bridge translates them to
 * dynamic-tool UI parts → useChat parses them → ToolCallPart renders. The
 * render path is the seam the unit/integration tests couldn't reach; this is
 * the positive-path eval (agent uses the right tool and answers).
 *
 * The mock's tool branch is triple-gated (tools present + user says "time" +
 * no prior tool result), so only THIS test triggers it.
 */

import { expect, test } from "../fixtures";

const TOOL_ANSWER = "Here is the current time you requested.";

test.describe("tool-calling loop (browser, full stack)", () => {
  test("the agent calls get_current_time and its use is visible in chat", async ({
    page,
  }) => {
    await page.goto("/");

    await page
      .getByPlaceholder("What would you like to know?")
      .fill("what time is it in UTC?");
    await page.getByRole("button", { name: "Send message" }).click();

    const log = page.getByRole("log");

    // The tool use is VISIBLE: the ToolCallPart chip shows the tool name.
    await expect(log.getByText("get_current_time")).toBeVisible({
      timeout: 20_000,
    });

    // The follow-up answer (second turn, after the tool result) streams in.
    await expect(log.getByText(TOOL_ANSWER)).toBeVisible({ timeout: 20_000 });
  });
});
