/**
 * Live updates over the owner WebSocket: a second tab of the same account sees
 * a chat created, progressing, finishing, and renamed in the first tab, with
 * no reload and no polling interval to wait out. The Run is held at the model
 * server (HOLD:<token>) so its in-flight state is observable deterministically.
 */

import { randomUUID } from "node:crypto";
import { readyComposer } from "../../support/composer";
import { expect, test } from "../../support/fixtures";

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;
const modelUrl = `http://localhost:${process.env.E2E_MODEL_PORT ?? "4303"}`;

async function releaseHold(token: string): Promise<void> {
  const response = await fetch(`${modelUrl}/hold/${token}/release`, {
    method: "POST",
  });
  expect(response.ok).toBe(true);
}

test("a second tab sees a new chat, its run progress, and a rename live", async ({
  page,
  context,
  account,
}) => {
  test.setTimeout(60_000);
  const holdToken = `live-${randomUUID()}`;

  // Tab B: the observer, opened first and never reloaded.
  const observer = await context.newPage();
  await observer.goto("/");
  await readyComposer(observer);

  try {
    // Tab A: start a Run the model server holds open.
    await page.goto("/");
    const input = await readyComposer(page);
    await input.fill(`HOLD:${holdToken} live updates`);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 15_000 });
    const chatId = new URL(page.url()).pathname.split("/").at(-1);

    // Created and in flight: tab B's row appears and shows the live phase.
    const row = observer.locator(`a[href="/chat/${chatId}"]`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByLabel("Generating response: thinking")).toBeVisible({
      timeout: 10_000,
    });

    // Finished: the processing indicator clears in tab B without a reload.
    await releaseHold(holdToken);
    await expect(page.getByRole("log").getByText(/Mocked/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(row.getByLabel(/^Generating response/)).toHaveCount(0, {
      timeout: 10_000,
    });

    // Renamed elsewhere (API, as another device would): tab B shows the name.
    const renamed = `Live rename ${Date.now()}`;
    const response = await page.request.patch(
      `${apiUrl}/api/v1/chats/${chatId}`,
      {
        headers: { Authorization: `Bearer ${account.token}` },
        data: { title: renamed },
      },
    );
    expect(response.status(), await response.text()).toBe(200);
    await expect(row).toContainText(renamed, { timeout: 5000 });
  } finally {
    await releaseHold(holdToken).catch(() => undefined);
  }
});
