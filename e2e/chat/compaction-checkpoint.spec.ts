/**
 * Compaction checkpoint browser e2e (#57 UI surfacing).
 *
 * Owner-reported bug: a real compaction exists server-side (confirmed via
 * `GET /chats/:id/compaction`) but the Checkpoint never rendered on a chat
 * page reload. The render pipeline couldn't be reproduced failing against a
 * synthetic jsdom render (see chat-page.compaction.test.tsx), so this spec is
 * the faithful end-to-end reproduction vehicle: real useChat, real SSR
 * hydration, real fetch, a real hard reload — the one thing a unit test
 * cannot fake.
 *
 * The chat + messages are created through the real app (UI send, same as
 * chat-flow.spec.ts); the compaction itself is seeded directly into Postgres
 * (deterministic — driving a real compaction via COMPACTION_TOKEN_THRESHOLD
 * would depend on the mock model's token accounting) via seed-compaction.ts.
 *
 * This passing does NOT confirm what actually went wrong in the owner's
 * environment — it proves the query→render pipeline works end-to-end
 * against this harness's network stack, which is a different (mocked,
 * same-origin) environment than the one the bug was reported in. The
 * strongest remaining lead is a silently-erroring compaction fetch (see
 * apps/web/lib/services/chat/compaction-query.test.tsx and chat-page.tsx's
 * compactionError logging, added defensively for exactly this).
 */

import { expect, test } from "../fixtures";
import { seedCompaction } from "./seed-compaction";

const ANSWER = "Mocked answer from the e2e model server.";
const SEEDED_SUMMARY =
  "E2E-seeded summary: the user asked about the project roadmap and the assistant outlined next steps.";

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;

test.describe("compaction checkpoint (worker execution mode)", () => {
  test("a compaction seeded after messages exist renders as a visible Checkpoint on reload, and opens the summary in a modal", async ({
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

    seedCompaction(chatId, maxSeq, SEEDED_SUMMARY);

    // A real hard reload — the exact step Leo took where the Checkpoint
    // failed to appear despite the endpoint returning the compaction.
    await page.reload();

    const checkpoint = page.getByRole("button", {
      name: "Earlier messages summarized for context",
    });
    await expect(checkpoint).toBeVisible({ timeout: 15_000 });

    await checkpoint.click();

    const dialog = page.getByRole("dialog", {
      name: "Compacted conversation summary",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(SEEDED_SUMMARY)).toBeVisible();
  });
});
