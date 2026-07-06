/**
 * Compaction checkpoint browser e2e (#57 UI surfacing, #136 read-side merge).
 *
 * Owner-reported bug: a real compaction existed server-side but the
 * Checkpoint never rendered on a chat page reload. That render pipeline
 * couldn't be reproduced failing against a synthetic jsdom render (see
 * chat-page.compaction.test.tsx) — this spec is the faithful end-to-end
 * vehicle: real useChat, real SSR hydration, real fetch, a real hard reload
 * — the one thing a unit test cannot fake. It passing does NOT confirm what
 * actually went wrong in the owner's environment (this harness's network
 * stack is mocked/same-origin, unlike the field report), but #136's merge —
 * compaction is now embedded in the SAME `GET :id/messages` response the
 * messages themselves come from, not a second, independently-failing
 * request — structurally removes the leading suspect (a silently-erroring
 * SECOND fetch) by construction: there is only one fetch left to fail, and
 * if it does, the messages themselves would visibly be missing too.
 *
 * The chat + messages are created through the real app (UI send, same as
 * chat-flow.spec.ts); the compaction itself is seeded directly into Postgres
 * (deterministic — driving a real compaction via COMPACTION_TOKEN_THRESHOLD
 * would depend on the mock model's token accounting) via seed-compaction.ts,
 * including `usage` so the design's real compression-stats line ("N messages
 * · saved X tokens" / "before → after · model") renders, not the timestamp
 * fallback.
 */

import { expect, test } from "../fixtures";
import { seedCompaction } from "./seed-compaction";

const ANSWER = "Mocked answer from the e2e model server.";
const SEEDED_SUMMARY =
  "E2E-seeded summary: the user asked about the project roadmap and the assistant outlined next steps.";
const SEEDED_USAGE = {
  inputTokens: 71400,
  outputTokens: 12800,
  model: "e2e-mock",
};

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;

test.describe("compaction checkpoint (worker execution mode)", () => {
  test("a compaction seeded after messages exist renders as a visible Checkpoint chip on reload, and expands an inline result card with the summary", async ({
    page,
    account,
  }) => {
    await page.goto("/");

    // Create a chat with a couple of real turns through the app, same as
    // chat-flow.spec.ts — this is the "the checkpoint feature must sit
    // alongside real, already-rendering messages" scenario Leo tested.
    const input = page.getByPlaceholder("What would you like to know?");
    await input.fill("Tell me about the roadmap");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("log").getByText(ANSWER)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, {
      timeout: 15_000,
    });

    const chatId = new URL(page.url()).pathname.split("/").pop();
    if (!chatId) {
      throw new Error(`Could not extract chat id from URL: ${page.url()}`);
    }

    await page
      .getByPlaceholder("What would you like to know?")
      .fill("And what about next steps?");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("log").getByText(ANSWER).nth(1)).toBeVisible({
      timeout: 20_000,
    });

    // Fetch the real seq values the same way the app itself would, so the
    // seeded uptoSeq matches an actual message boundary (Leo's real scenario:
    // uptoSeq at/near the end of the loaded history — everything summarized).
    const messagesResponse = await page.request.get(
      `${apiUrl}/api/v1/chats/${chatId}/messages`,
      { headers: { Authorization: `Bearer ${account.token}` } },
    );
    expect(messagesResponse.ok()).toBe(true);
    const { messages } = (await messagesResponse.json()) as {
      messages: Array<{ seq: number }>;
    };
    expect(messages.length).toBeGreaterThan(0);
    const maxSeq = Math.max(...messages.map((m) => m.seq));

    seedCompaction(chatId, maxSeq, SEEDED_SUMMARY, SEEDED_USAGE);

    // A real hard reload — the exact step Leo took where the Checkpoint
    // failed to appear despite the endpoint returning the compaction.
    await page.reload();

    const checkpoint = page.getByRole("button", { name: "Context compacted" });
    await expect(checkpoint).toBeVisible({ timeout: 15_000 });

    // Collapsed by default — the design's result card isn't in the DOM yet.
    await expect(page.getByText("Compaction result")).not.toBeVisible();
    // 71400 - 12800 = 58600 -> "58.6k" (design's own token-formatting
    // convention — see compaction-boundary.tsx's formatTokenCount).
    await expect(checkpoint.getByText(/saved 58\.6k tokens/)).toBeVisible();

    await checkpoint.click();

    // Design's inline disclosure (not a modal): the card renders directly
    // below the chip, in the normal message flow, with the real compression
    // stats (not the timestamp fallback, since usage was seeded).
    await expect(page.getByText("Compaction result")).toBeVisible();
    await expect(
      page.getByText("71.4k → 12.8k tokens · e2e-mock"),
    ).toBeVisible();
    await expect(page.getByText(SEEDED_SUMMARY)).toBeVisible();
  });
});
