import { expect, type APIRequestContext, type Page } from "@playwright/test";

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;
const password = "Password123!";

export type TestAccount = {
  email: string;
  name: string;
  password: string;
  token: string;
};

export function uniqueEmail(label: string, parallelIndex: number): string {
  return `e2e-${label}-${Date.now()}-${parallelIndex}-${Math.random().toString(36).slice(2)}@example.com`;
}

export async function registerAccount(
  request: APIRequestContext,
  label: string,
  parallelIndex: number,
): Promise<TestAccount> {
  const email = uniqueEmail(label, parallelIndex);
  const name = `E2E ${label}`;
  const response = await request.post(`${apiUrl}/auth/v1/register`, {
    data: { email, name, password },
  });

  if (!response.ok()) {
    throw new Error(
      `Failed to register ${email}: ${response.status()} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { token?: string };
  if (!body.token) {
    throw new Error(`Register response for ${email} did not include a token`);
  }

  return { email, name, password, token: body.token };
}

export async function loginViaUi(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await page.getByLabel(/email/i).fill(account.email);
  await page.getByLabel(/password/i).fill(account.password);
  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/auth/v1/login") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^sign in$/i }).click();

  const response = await loginResponse;
  expect(response.status()).toBe(200);
}

export async function expectProtectedShell(page: Page, account: TestAccount) {
  await expect(page.getByText(account.email)).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByPlaceholder(/what would you like to know/i),
  ).toBeVisible();
}

export async function revokeAllSessions(
  request: APIRequestContext,
  account: TestAccount,
): Promise<void> {
  const response = await request.delete(`${apiUrl}/auth/v1/sessions`, {
    headers: {
      Authorization: `Bearer ${account.token}`,
    },
    params: {
      scope: "all",
    },
  });

  if (!response.ok()) {
    throw new Error(
      `Failed to revoke sessions for ${account.email}: ${response.status()} ${await response.text()}`,
    );
  }
}

export async function expectLoginPage(page: Page) {
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByLabel(/email/i)).toBeVisible();
}
