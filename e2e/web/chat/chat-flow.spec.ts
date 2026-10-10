/**
 * Chat-flow browser e2e (#80) + refresh-resume proof (#49).
 *
 * Runs against the full stack — Next.js web, NestJS api in WORKER execution
 * mode (pg-boss queue, run-event bridge), throwaway Postgres, and the
 * deterministic mock model server (e2e/support/model-server.ts, wired via
 * OPENAI_BASE_URL, #88). Every send here exercises the durable-run pipeline
 * end-to-end from a real browser.
 */

import { expect, test } from "../../support/fixtures";

const ANSWER = "Mocked answer from the e2e model server.";
// The structured title the model mock returns for `generate_title`; a fallback
// to text would title the chat with the mock's default streamed answer.
const GENERATED_TITLE = "E2E Generated Title";
const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;

function isTitledChat(value: unknown): value is { title: unknown } {
  return value !== null && typeof value === "object" && "title" in value;
}

test.describe("chat flow (worker execution mode)", () => {
  test("create → stream → render: first message creates the chat and streams the answer", async ({
    page,
    account,
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

    // The turn completed: the route was the chat's identity all along (the
    // root redirected to `/chat/:id` before UI mount, #98), finish cleared
    // the `?draft` marker, and the sidebar shows the generated-title entry.
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/, {
      timeout: 15_000,
    });

    // Title generation took the structured path: a fallback to text would
    // still title the chat, but with the mock's default answer.
    const chatId = new URL(page.url()).pathname.split("/").at(-1);
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${apiUrl}/api/v1/chats/${chatId}`,
            { headers: { Authorization: `Bearer ${account.token}` } },
          );
          expect(response.status(), await response.text()).toBe(200);
          const body: unknown = await response.json();
          return isTitledChat(body) ? body.title : undefined;
        },
        { timeout: 15_000 },
      )
      .toBe(GENERATED_TITLE);
  });

  test("refresh mid-FIRST-answer resumes the draft run and completes (#49)", async ({
    page,
  }) => {
    await page.goto("/");

    const input = page.getByPlaceholder("What would you like to know?");
    // "SLOW" makes the mock drip tokens (~4s total) so the reload happens
    // mid-run — the run itself survives in the worker.
    await input.fill("SLOW please answer slowly");
    await page.getByRole("button", { name: "Send message" }).click();

    // First token on screen: the run is streaming. Reload IMMEDIATELY —
    // the URL is the write half of the resume contract now: the root
    // redirected to `/chat/:id` before mount, and send marked first-send
    // intent as `?draft=sent` via the History API, so a reload re-enters
    // the same chat on the recovery path. (No `?draft=sent` assertion: if
    // the stream finishes before this read, finish legitimately clears the
    // marker; the outcome assertions below cover both timings.)
    await expect(
      page.getByRole("log").getByText("Mocked", { exact: false }),
    ).toBeVisible({ timeout: 20_000 });

    const draftPath = new URL(page.url()).pathname;
    expect(draftPath).toMatch(/^\/chat\/[0-9a-f-]{36}$/);
    await page.reload();

    // The FULL answer appears — the run survived the socket (worker mode),
    // its deltas replay from the durable event log, and the tail follows
    // live — on the SAME chat route, with the draft marker gone at finish.
    await expect(page.getByRole("log").getByText(ANSWER)).toBeVisible({
      timeout: 25_000,
    });
    await expect(page).toHaveURL(new RegExp(`${draftPath}$`), {
      timeout: 15_000,
    });
  });

  test("refresh mid-answer on a persisted chat resumes the run (#49)", async ({
    page,
  }) => {
    await page.goto("/");

    // Turn one completes normally and adopts the deep link.
    const input = page.getByPlaceholder("What would you like to know?");
    await input.fill("First turn");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("log").getByText(ANSWER)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 15_000 });

    // Turn two is slow; reload mid-answer on the persisted chat page. Wait
    // for the second answer's FIRST token (nth(1) of the shared prefix — the
    // full-answer locator would only match after completion, and waiting for
    // it would degenerate this into a persistence test).
    await page
      .getByPlaceholder("What would you like to know?")
      .fill("SLOW again please");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(
      page.getByRole("log").getByText("Mocked", { exact: false }).nth(1),
    ).toBeVisible({ timeout: 20_000 });
    await page.reload();

    // Both answers render: turn one from history, turn two replayed from the
    // durable run and followed to completion.
    await expect(page.getByRole("log").getByText(ANSWER).nth(1)).toBeVisible({
      timeout: 25_000,
    });
  });
});
