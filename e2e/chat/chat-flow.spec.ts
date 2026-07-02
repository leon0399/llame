/**
 * Chat-flow browser e2e (#80) + refresh-resume proof (#49).
 *
 * Runs against the full stack — Next.js web, NestJS api in WORKER execution
 * mode (pg-boss queue, run-event bridge), throwaway Postgres, and the
 * deterministic mock model server (e2e/model-server.ts, wired via
 * OPENAI_BASE_URL, #88). Every send here exercises the durable-run pipeline
 * end-to-end from a real browser.
 */

import { expect, test } from "../fixtures";

const ANSWER = "Mocked answer from the e2e model server.";

test.describe("chat flow (worker execution mode)", () => {
  test("create → stream → render: first message creates the chat and streams the answer", async ({
    page,
  }) => {
    await page.goto("/");

    const input = page.getByPlaceholder("What would you like to know?");
    await input.fill("Hello from the browser e2e");
    await page.getByRole("button", { name: "Send message" }).click();

    // The streamed answer renders in full (create → stream → render, #80).
    // Scoped to the conversation log: the sidebar shows the generated title.
    await expect(page.getByRole("log").getByText(ANSWER)).toBeVisible({
      timeout: 20_000,
    });

    // The turn completed: the chat adopted a deep link (#98) and the sidebar
    // shows the server-generated title turn's chat entry.
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 15_000 });
  });

  test("refresh mid-answer resumes the run and completes (#49)", async ({
    page,
  }) => {
    await page.goto("/");

    const input = page.getByPlaceholder("What would you like to know?");
    // "SLOW" makes the mock drip tokens (~4s total) so the reload happens
    // mid-run — the run itself survives in the worker.
    await input.fill("SLOW please answer slowly");
    await page.getByRole("button", { name: "Send message" }).click();

    // First token on screen: the run is streaming.
    await expect(
      page.getByRole("log").getByText("Mocked", { exact: false }),
    ).toBeVisible({ timeout: 20_000 });

    // Reload mid-answer. The POST connection dies with the page; the run does
    // not (worker mode). We land on the deep link, where the persisted chat
    // session mounts with resume: true and reconnects to the active run.
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 15_000 });
    await page.reload();

    // The FULL answer appears — replayed from the durable run-event log and
    // followed live to completion. Nothing was lost with the socket.
    await expect(page.getByRole("log").getByText(ANSWER)).toBeVisible({
      timeout: 25_000,
    });
  });
});
