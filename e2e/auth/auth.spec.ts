import {
  expectLoginPage,
  expectProtectedShell,
  loginViaUi,
  revokeAllSessions,
  test,
  expect,
} from "../fixtures";

const emptyStorageState = { cookies: [], origins: [] };

test("restores worker-scoped authenticated storage state", async ({
  page,
  account,
}) => {
  await page.goto("/");

  await expectProtectedShell(page, account);
});

test.describe("anonymous auth flows", () => {
  test.use({ storageState: emptyStorageState });

  test("logs in an existing user", async ({ page, account }) => {
    await page.goto("/login");
    await loginViaUi(page, account);

    await expect(page).toHaveURL(/\/$/);
    await expectProtectedShell(page, account);
  });

  test("shows invalid-credential errors without leaving the login form", async ({
    page,
  }) => {
    await page.goto("/login");

    const reloadGuard = `invalid-login-${test.info().parallelIndex}`;
    await page.evaluate((value) => {
      (
        window as Window & { __invalidLoginReloadGuard?: string }
      ).__invalidLoginReloadGuard = value;
    }, reloadGuard);

    await page.getByLabel(/email/i).fill("missing@example.com");
    await page.getByLabel(/password/i).fill("wrong-password");
    const loginResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/auth/v1/login") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /^sign in$/i }).click();

    expect((await loginResponse).status()).toBe(401);
    await expect(page.getByText("Invalid email or password")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __invalidLoginReloadGuard?: string })
              .__invalidLoginReloadGuard ?? null,
        ),
      )
      .toBe(reloadGuard);
  });

  test("honors same-origin callbackUrl after login", async ({
    page,
    account,
  }) => {
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
      account,
    }) => {
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
    freshAccount,
  }) => {
    await page.goto("/login");
    await loginViaUi(page, freshAccount);
    await expectProtectedShell(page, freshAccount);

    await page.getByRole("button", { name: freshAccount.email }).click();
    await page.getByRole("menuitem", { name: /log out/i }).click();

    await expectLoginPage(page);

    await page.goto("/settings");
    await expectLoginPage(page);
  });

  test("redirects when a still-present browser cookie has been revoked", async ({
    page,
    request,
    freshAccount,
  }) => {
    await page.goto("/login");
    await loginViaUi(page, freshAccount);
    await expectProtectedShell(page, freshAccount);

    await revokeAllSessions(request, freshAccount);
    await page.goto("/settings");

    await expectLoginPage(page);
  });
});
