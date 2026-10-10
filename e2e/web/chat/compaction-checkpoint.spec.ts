/**
 * Compaction checkpoint browser e2e (#57 UI surfacing).
 *
 * Owner-reported bug: a real checkpoint existed server-side but the boundary
 * never rendered on a chat page reload. This spec is the faithful end-to-end
 * vehicle: real useChat, real SSR hydration, real fetch, a real hard reload.
 *
 * The chat turns are created through the real app; the checkpoint itself is
 * seeded deterministically as a `messages.role = checkpoint` row so the
 * owner response exercises the same row DTO and API-computed count as a
 * published checkpoint. It is seeded AFTER the triggering turn, as production
 * publishes it, so its own sequence is past the boundary it names and only a
 * boundary-keyed marker lands where the assertions expect.
 */

import type { Locator } from "@playwright/test";

import { readyComposer } from "../../support/composer";
import { expect, test } from "../../support/fixtures";
import { seedCheckpoint } from "./seed-compaction";

const ANSWER = "Mocked answer from the e2e model server.";
const SEEDED_SUMMARY =
  "E2E-seeded summary: the user asked about the project roadmap and the assistant outlined next steps.";
const SEEDED_USAGE = {
  inputTokens: 71_400,
  outputTokens: 12_800,
  modelId: "e2e-mock",
};

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;

/** Whether `first` precedes `second` in document order. */
async function precedes(first: Locator, second: Locator): Promise<boolean> {
  const secondHandle = await second.elementHandle();
  if (!secondHandle) {
    throw new Error("Could not locate the later element");
  }
  return first.evaluate(
    (earlier, later) =>
      Boolean(
        earlier.compareDocumentPosition(later) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    secondHandle,
  );
}

test.describe("compaction checkpoint (worker execution mode)", () => {
  test("a checkpoint published after its triggering user turn renders at its boundary on reload and expands its summary", async ({
    page,
    account,
  }) => {
    await page.goto("/");

    // Create a chat with a couple of real turns through the app, same as
    // chat-flow.spec.ts — this is the "the checkpoint feature must sit
    // alongside real, already-rendering messages" scenario Leo tested.
    const input = await readyComposer(page);
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

    // Fetch the real seq values the same way the app itself would, so the
    // checkpoint boundary matches the last committed row before the
    // triggering user turn.
    const messagesResponse = await page.request.get(
      `${apiUrl}/api/v1/chats/${chatId}/messages`,
      { headers: { Authorization: `Bearer ${account.token}` } },
    );
    // Status in the message: a bare `.ok()` boolean turns any failure into
    // "expected true, received false" with no clue whether it was 401, 429, …
    expect(
      messagesResponse.ok(),
      `GET messages failed with ${messagesResponse.status()}`,
    ).toBe(true);
    // SAFETY: this is the api's own chat-messages endpoint (under test
    // here), whose { messages: [...] } envelope is fixed by its own OpenAPI
    // contract.
    const { messages } = (await messagesResponse.json()) as {
      messages: Array<{ seq: number }>;
    };
    expect(messages.length).toBeGreaterThan(0);
    const boundarySeq = Math.max(...messages.map((m) => m.seq));

    // The triggering turn runs to completion BEFORE the checkpoint exists, so
    // the seeded row lands after it (past its seq) while naming the earlier
    // boundary — a placement keyed on the checkpoint row's own seq would put
    // the marker at the end of the transcript, not before this turn.
    await page
      .getByPlaceholder("What would you like to know?")
      .fill("And what about next steps?");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("log").getByText(ANSWER).nth(1)).toBeVisible({
      timeout: 20_000,
    });
    seedCheckpoint(chatId, boundarySeq, SEEDED_SUMMARY, {
      usage: SEEDED_USAGE,
      ownerUserId: account.id,
    });

    // A real hard reload — the exact step Leo took where the Checkpoint
    // failed to appear despite the endpoint returning the compaction.
    await page.reload();

    const checkpoint = page.getByRole("button", { name: "Context compacted" });
    await expect(checkpoint).toBeVisible({ timeout: 15_000 });
    const triggeringMessage = page.getByText("And what about next steps?");
    await expect(triggeringMessage).toBeVisible();
    // Between the absorbed first answer and the triggering turn.
    expect(
      await precedes(
        page.getByRole("log").getByText(ANSWER).first(),
        checkpoint,
      ),
    ).toBe(true);
    expect(await precedes(checkpoint, triggeringMessage)).toBe(true);

    // Collapsed by default — the design's result card isn't in the DOM yet.
    await expect(page.getByText("Compaction result")).not.toBeVisible();
    // 71400 - 12800 = 58600 -> "58.6k" (design's own token-formatting
    // convention — see compaction-boundary.tsx's formatTokenCount).
    // The count is the API-computed absorbed-row total (the first turn: 2).
    await expect(
      checkpoint.getByText("2 messages · saved 58.6k tokens"),
    ).toBeVisible();

    // After a hard reload the SSR HTML is visible (and passes Playwright's
    // actionability checks) well before React hydrates it, and a click that
    // lands in that window is silently swallowed — the chip's onClick isn't
    // attached yet. CI's loaded runner loses that race deterministically
    // (trace: the hydration pass logged AFTER the click dispatched), so
    // retry the click until the disclosure actually happens instead of
    // racing hydration once.
    //
    // Design's inline disclosure (not a modal): the card renders directly
    // below the chip, in the normal message flow, with the real compression
    // stats (not the timestamp fallback, since usage was seeded).
    await expect(async () => {
      // The chip is a toggle: only click while collapsed, so a retry can
      // re-attempt a swallowed click but never close a disclosure that a
      // previous attempt already opened.
      if ((await checkpoint.getAttribute("aria-expanded")) !== "true") {
        await checkpoint.click();
      }
      await expect(page.getByText("Compaction result")).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ timeout: 15_000 });
    await expect(
      page.getByText("71.4k → 12.8k tokens · e2e-mock"),
    ).toBeVisible();
    await expect(page.getByText(SEEDED_SUMMARY)).toBeVisible();
  });
});
