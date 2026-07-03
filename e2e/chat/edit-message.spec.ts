/**
 * Edit & resubmit browser e2e — regression protection for the riskiest recent
 * chat feature (a DESTRUCTIVE mutation: rewrite the last user message, delete its
 * reply, re-run). Its review caught a P0 where the AI SDK transport silently
 * DROPPED `editUserMessage` (an allowlist, not a passthrough) — invisible to
 * unit/integration tests, catchable only cross-layer + through a reload.
 *
 * Runs against the full stack (Next.js web + NestJS api in worker mode + throwaway
 * Postgres + the deterministic mock model server), authenticated via the
 * worker-scoped fixture. Mirrors e2e/chat/chat-flow.spec.ts.
 */

import { expect, test } from "../fixtures";

const ANSWER = "Mocked answer from the e2e model server.";
const TYPO = "frist draft with a typo";
const FIXED = "corrected question after the edit";

test.describe("edit & resubmit (worker execution mode)", () => {
  test("editing the last user message rewrites it server-side and re-runs", async ({
    page,
  }) => {
    await page.goto("/");

    const input = page.getByPlaceholder("What would you like to know?");
    await input.fill(TYPO);
    await page.getByRole("button", { name: "Send message" }).click();

    // First turn completes: reply streamed + chat persisted (deep link).
    await expect(page.getByRole("log").getByText(ANSWER)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 15_000 });

    // Open the inline editor (the button + textbox share an accessible name;
    // role disambiguates). It is prefilled with the original text.
    await page.getByRole("button", { name: "Edit message" }).click();
    const editor = page.getByRole("textbox", { name: "Edit message" });
    await expect(editor).toHaveValue(TYPO);
    await editor.fill(FIXED);
    await page.getByRole("button", { name: "Save & submit" }).click();

    // The turn re-ran: a fresh reply streams (the old reply was stripped by the
    // regenerate, so this ANSWER is the NEW one, not a stale match).
    await expect(page.getByRole("log").getByText(ANSWER)).toBeVisible({
      timeout: 20_000,
    });
    // ...and the re-run COMPLETED: the edit button is gated on status
    // ready/error, so its reappearance means the new reply is fully persisted.
    // Without this wait, the reload could race the persist and see 0 replies.
    await expect(page.getByRole("button", { name: "Edit message" })).toBeVisible(
      { timeout: 20_000 },
    );

    // RELOAD — the transcript now comes from the SERVER (DB), proving what
    // actually persisted. A dropped `editUserMessage` would leave the OLD text
    // server-side; a client-only check would falsely pass because setMessages
    // updated the bubble locally.
    await page.reload();
    const log = page.getByRole("log");
    await expect(log.getByText(FIXED)).toBeVisible({ timeout: 15_000 });
    await expect(log.getByText(TYPO)).toHaveCount(0);
    // Exactly one reply survived (the old one was superseded, not appended).
    await expect(log.getByText(ANSWER)).toBeVisible({ timeout: 15_000 });
    await expect(log.getByText(ANSWER)).toHaveCount(1);
  });
});
