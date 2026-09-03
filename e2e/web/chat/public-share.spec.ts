/** Public-share parity: a logged-out browser can render a shared chat. */

import { expect, test } from "../../support/fixtures";

const ANSWER = "Mocked answer from the e2e model server.";
const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;

test("an anonymous visitor can open a public shared chat", async ({
  browser,
  page,
  account,
}) => {
  await page.goto("/");

  const input = page.getByPlaceholder("What would you like to know?");
  await input.fill("Public share parity");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("log").getByText(ANSWER)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/, {
    timeout: 15_000,
  });

  const chatId = new URL(page.url()).pathname.split("/").pop();
  if (!chatId) throw new Error(`Could not extract chat id from ${page.url()}`);

  const shareResponse = await page.request.patch(
    `${apiUrl}/api/v1/chats/${chatId}`,
    {
      headers: { Authorization: `Bearer ${account.token}` },
      data: { visibility: "public" },
    },
  );
  expect(
    shareResponse.ok(),
    `Making chat public failed with ${shareResponse.status()}`,
  ).toBe(true);

  const anonymousContext = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const anonymousPage = await anonymousContext.newPage();
    await anonymousPage.goto(`/shared/${chatId}`);

    await expect(anonymousPage).toHaveURL(new RegExp(`/shared/${chatId}$`));
    await expect(
      anonymousPage.getByText("Shared conversation · read-only"),
    ).toBeVisible();
    await expect(
      anonymousPage.locator("main > div").getByText(ANSWER, { exact: true }),
    ).toBeVisible();
  } finally {
    await anonymousContext.close();
  }
});
