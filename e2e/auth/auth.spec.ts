import { expect, test } from "@playwright/test";
import {
  expectLoginPage,
  expectProtectedShell,
  loginViaUi,
  registerAccount,
  revokeAllSessions,
} from "./helpers";

test.use({ storageState: { cookies: [], origins: [] } });

test("logs in an existing user", async ({ page, request }) => {
  const account = await registerAccount(
    request,
    "login-success",
    test.info().parallelIndex,
  );

  await page.goto("/login");
  await loginViaUi(page, account);

  await expect(page).toHaveURL(/\/$/);
  await expectProtectedShell(page, account);
});

test("shows invalid-credential errors without leaving the login form", async ({
  page,
}) => {
  await page.goto("/login");

  await page.getByLabel(/email/i).fill("missing@example.com");
  await page.getByLabel(/password/i).fill("wrong-password");
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await expect(page.getByText("Invalid email or password")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel(/email/i)).toBeVisible();
});

test("honors same-origin callbackUrl after login", async ({
  page,
  request,
}) => {
  const account = await registerAccount(
    request,
    "callback-internal",
    test.info().parallelIndex,
  );

  await page.goto("/login?callbackUrl=%2Fsettings");
  await loginViaUi(page, account);

  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole("heading", { name: /^settings$/i }),
  ).toBeVisible();
});

for (const callbackUrl of [
  "https://evil.example/path",
  "//evil.example/path",
  "/\\evil.example",
]) {
  test(`blocks open redirect callbackUrl ${callbackUrl}`, async ({
    page,
    request,
  }) => {
    const account = await registerAccount(
      request,
      "callback-external",
      test.info().parallelIndex,
    );

    await page.goto(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    await loginViaUi(page, account);

    await expect(page).toHaveURL(/\/$/);
    await expectProtectedShell(page, account);
  });
}

test("redirects no-cookie access to login with callbackUrl", async ({
  page,
}) => {
  await page.goto("/settings");

  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fsettings$/);
  await expect(page.getByLabel(/email/i)).toBeVisible();
});

test("logs out and blocks protected routes afterwards", async ({
  page,
  request,
}) => {
  const account = await registerAccount(
    request,
    "logout",
    test.info().parallelIndex,
  );

  await page.goto("/login");
  await loginViaUi(page, account);
  await expectProtectedShell(page, account);

  await page.getByRole("button", { name: new RegExp(account.email) }).click();
  await page.getByRole("menuitem", { name: /log out/i }).click();

  await expectLoginPage(page);

  await page.goto("/settings");
  await expectLoginPage(page);
});

test("redirects when a still-present browser cookie has been revoked", async ({
  page,
  request,
}) => {
  const account = await registerAccount(
    request,
    "revoked-session",
    test.info().parallelIndex,
  );

  await page.goto("/login");
  await loginViaUi(page, account);
  await expectProtectedShell(page, account);

  await revokeAllSessions(request, account);
  await page.goto("/settings");

  await expectLoginPage(page);
});
