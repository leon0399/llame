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
 * published checkpoint.
 */

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

test.describe("compaction checkpoint (worker execution mode)", () => {
  test("a checkpoint row seeded before the triggering user turn renders before that turn on reload and expands its summary", async ({
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
    const maxSeq = Math.max(...messages.map((m) => m.seq));

    seedCheckpoint(chatId, maxSeq, SEEDED_SUMMARY, {
      usage: SEEDED_USAGE,
      ownerUserId: account.id,
    });
    await page
      .getByPlaceholder("What would you like to know?")
      .fill("And what about next steps?");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("log").getByText(ANSWER).nth(1)).toBeVisible({
      timeout: 20_000,
    });
    const seededResponse = await page.request.get(
      `${apiUrl}/api/v1/chats/${chatId}/messages`,
      { headers: { Authorization: `Bearer ${account.token}` } },
    );
    expect(seededResponse.ok()).toBe(true);
    // SAFETY: this is the api's own chat-messages endpoint (under test
    // here), whose { messages: [...] } envelope is fixed by its own OpenAPI
    // contract.
    const seededBody = (await seededResponse.json()) as {
      messages: Array<{
        role: string;
        seq: number;
        absorbedThroughSeq?: number;
        absorbedMessageCount?: number;
      }>;
    };
    const checkpointRow = seededBody.messages.find(
      (message) => message.role === "checkpoint",
    );
    expect(checkpointRow).toMatchObject({
      absorbedThroughSeq: maxSeq,
      absorbedMessageCount: 2,
    });

    // A real hard reload — the exact step Leo took where the Checkpoint
    // failed to appear despite the endpoint returning the compaction.
    await page.reload();

    const checkpoint = page.getByRole("button", { name: "Context compacted" });
    await expect(checkpoint).toBeVisible({ timeout: 15_000 });
    const triggeringMessage = page.getByText("And what about next steps?");
    await expect(triggeringMessage).toBeVisible();
    const triggeringMessageHandle = await triggeringMessage.elementHandle();
    if (!triggeringMessageHandle) {
      throw new Error("Could not locate the triggering user message");
    }
    expect(
      await checkpoint.evaluate(
        (boundary, message) =>
          Boolean(
            boundary.compareDocumentPosition(message) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        triggeringMessageHandle,
      ),
    ).toBe(true);

    // Collapsed by default — the design's result card isn't in the DOM yet.
    await expect(page.getByText("Compaction result")).not.toBeVisible();
    // 71400 - 12800 = 58600 -> "58.6k" (design's own token-formatting
    // convention — see compaction-boundary.tsx's formatTokenCount).
    await expect(checkpoint.getByText(/saved 58\.6k tokens/)).toBeVisible();

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
