/**
 * The latest turn's Continue and Regenerate actions, end to end
 * (openspec/changes/continue-regenerate-turns, task 5.5).
 *
 * Continue: the mock model calls `search_conversations` and then fails the
 * next request, which leaves the Run `failed` with its settled tool step
 * persisted — the state the action resumes from. The owner continues it, the
 * api replays the kept step, and the reply holds the kept tool part once
 * beside the new answer (no second execution).
 *
 * Regenerate: a completed turn that ran `bash` asks before it discards a call
 * whose effects stay. A cancel sends nothing; a confirm posts the follow-up
 * Run, replaces the answer, and leaves the `regenerate` notice on the user
 * message.
 */

import { randomUUID } from "node:crypto";

import { readyComposer } from "../../support/composer";
import { expect, test } from "../../support/fixtures";

const FOLLOW_UP_ROUTE =
  /\/api\/v1\/chats\/[0-9a-f-]{36}\/messages\/[0-9a-f-]{36}\/runs$/;

const REGENERATE_NOTICE =
  "An earlier attempt at this turn was discarded after it ran tools whose effects stay.";

test("continues a failed agentic turn from its settled tool step", async ({
  page,
}) => {
  // The fixture fails the first request that carries a tool result for this
  // exact prompt, so every attempt (and every retry) fails its own turn.
  const prompt = `FAIL_AFTER_TOOL please search my past conversations for budget ${randomUUID()}`;
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const composer = await readyComposer(page);
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();

  const log = page.getByRole("log");
  // The tool call settled before the Run failed, so the failure left a reply
  // with a completed tool step.
  await expect(log.getByText("search_conversations")).toBeVisible({
    timeout: 30_000,
  });
  await expect(log.getByText("Completed")).toBeVisible({ timeout: 30_000 });
  // The reply's own usage records the failed attempt; the transient stream
  // error alert is not asserted because the post-finish refresh clears it.
  await expect(
    log.getByRole("button", { name: /Message usage: error/ }),
  ).toBeVisible({ timeout: 30_000 });

  const continueTurn = page.getByRole("button", {
    name: "Continue",
    exact: true,
  });
  await expect(continueTurn).toBeVisible({ timeout: 20_000 });
  const followUp = page.waitForRequest((request) =>
    FOLLOW_UP_ROUTE.test(new URL(request.url()).pathname),
  );
  await continueTurn.click();

  // Continue sends only the action: the Run it resumes owns the model.
  expect((await followUp).postDataJSON()).toEqual({ action: "continue" });

  // The reply keeps one tool step — the kept one, never re-executed — and the
  // new answer lands beside it.
  await expect(log.getByText("Here are the past conversations")).toBeVisible({
    timeout: 30_000,
  });
  await expect(log.getByText("search_conversations")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
});

test("regenerates a completed answer after confirming the calls it discards", async ({
  page,
}) => {
  // The bash fixture runs one command whose output the reply keeps, so the
  // completed answer holds an `execute_code` call a Regenerate would discard.
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const composer = await readyComposer(page);
  await composer.fill("host bash output fidelity e2e");
  await page.getByRole("button", { name: "Send message" }).click();

  const log = page.getByRole("log");
  await expect(
    log.getByRole("button").filter({ hasText: /^bash/u }).first(),
  ).toBeVisible({ timeout: 30_000 });
  const answer = log.getByText("Here are the past conversations", {
    exact: false,
  });
  await expect(answer).toBeVisible({ timeout: 30_000 });

  const regenerate = page.getByRole("button", {
    name: "Regenerate",
    exact: true,
  });
  await expect(regenerate).toBeVisible({ timeout: 20_000 });

  // Every follow-up request the browser sends, watched from before the first
  // click so the cancel proves it sent nothing.
  const followUps: Array<string> = [];
  page.on("request", (request) => {
    if (FOLLOW_UP_ROUTE.test(new URL(request.url()).pathname)) {
      followUps.push(request.postData() ?? "");
    }
  });

  await regenerate.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("bash");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(followUps).toEqual([]);

  const followUp = page.waitForRequest((request) =>
    FOLLOW_UP_ROUTE.test(new URL(request.url()).pathname),
  );
  await regenerate.click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Regenerate" })
    .click();

  // The follow-up Run repeats the completed turn's own model and mode.
  const body: unknown = (await followUp).postDataJSON();
  expect(body).toMatchObject({
    action: "regenerate",
    modelId: expect.stringMatching(/\S/u),
  });

  // The discarded attempt ran a call whose effects stay, so the turn's user
  // message now carries the notice, and the answer row was replaced in place
  // rather than added beside the old one.
  await expect(page.getByText(REGENERATE_NOTICE)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("log").getByRole("button").filter({ hasText: /^bash/u }),
  ).toHaveCount(1, { timeout: 30_000 });
});
