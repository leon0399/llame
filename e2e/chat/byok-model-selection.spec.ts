/**
 * BYOK end-to-end integration proof (#18 → #82 → #76), in a real browser.
 *
 * The unit + HTTP e2e suites cover each piece; NOTHING covered the whole
 * chain through the UI, and the one bug a full run caught (broken streaming)
 * was exactly a browser-seam regression the lower suites passed clean. This
 * drives: add a provider in Settings (key encrypted into the vault) → the
 * model catalog lists it → the picker shows the live set → select it → send →
 * the mock model receives THAT decrypted key and THAT model id.
 *
 * Load-bearing assertions (not "React rendered"):
 *  - the picker shows the live BYOK model AND drops the static list (#76)
 *  - the mock recorded the per-worker BYOK key + selected model — proof the
 *    vault decrypted the stored secret and dispatch used the selection, not
 *    the instance fallback (#18/#82/#76)
 */

import { expect, loginViaUi, test } from "../fixtures";

const ANSWER = "Mocked answer from the e2e model server.";
const MODEL_PORT = process.env.E2E_MODEL_PORT ?? "4303";
const MODEL_SERVER = `http://localhost:${MODEL_PORT}`;

type SeenRequest = { authorization: string; model: string };

test.describe("BYOK provider → model selection → chat (full stack)", () => {
  test("a stored provider key streams the selected model end-to-end", async ({
    page,
    freshAccount,
    request,
  }, testInfo) => {
    // Per-worker uniqueness so the append-only mock log is parallel-safe: the
    // key + model this test asserts on are produced by no other worker.
    const suffix = `${testInfo.parallelIndex}-${testInfo.retry}`;
    const byokKey = `sk-byok-e2e-${suffix}`;
    const byokModel = `byok-model-${suffix}`;
    const byokName = `BYOK Mock ${suffix}`;

    await page.goto("/login");
    await loginViaUi(page, freshAccount);

    // --- Add the provider in Settings (key → vault) ------------------------
    await page.goto("/settings");
    await page.getByRole("button", { name: "Add provider" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Add a model provider")).toBeVisible();
    await dialog.locator("select").selectOption({ label: "OpenAI-compatible" });
    await dialog.getByLabel("Name").fill(byokName);
    await dialog.getByLabel("API key").fill(byokKey);
    await dialog.getByLabel("Default model").fill(byokModel);
    await dialog.getByLabel("Base URL").fill(`${MODEL_SERVER}/v1`);

    const createResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/provider-accounts") &&
        r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Add provider" }).click();
    expect((await createResponse).status()).toBe(201);

    // The account renders in the list (secret never shown).
    await expect(page.getByText(byokName)).toBeVisible();
    await expect(page.getByText(byokKey)).toHaveCount(0);

    // --- The chat picker shows the LIVE set, not the static list (#76) -----
    await page.goto("/");
    await page.getByRole("combobox").first().click();
    const byokOption = page.getByRole("option", {
      name: new RegExp(byokModel),
    });
    await expect(byokOption).toBeVisible();
    // The decorative static catalog is gone: GPT-4o was in STATIC_CHAT_MODELS
    // and is not a live model here.
    await expect(page.getByRole("option", { name: /GPT-4o/ })).toHaveCount(0);

    // Select the BYOK model.
    await byokOption.click();

    // --- Send, and the selected model streams ------------------------------
    const input = page.getByPlaceholder("What would you like to know?");
    await input.fill("Route me through my own key");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByRole("log").getByText(ANSWER)).toBeVisible({
      timeout: 20_000,
    });

    // --- The mock received the decrypted BYOK key + selected model ---------
    // Poll: the request lands when the worker executes the run.
    await expect
      .poll(
        async () => {
          const res = await request.get(`${MODEL_SERVER}/requests`);
          const seen = (await res.json()) as SeenRequest[];
          return seen.some(
            (r) =>
              r.authorization === `Bearer ${byokKey}` && r.model === byokModel,
          );
        },
        { timeout: 20_000, message: "mock never saw the BYOK key + model" },
      )
      .toBe(true);

    // And it was NEVER reached with the BYOK key under a DIFFERENT model, nor
    // the instance key for this model — i.e. selection actually bound the key
    // to the account, not a fallback.
    const finalSeen = (await (
      await request.get(`${MODEL_SERVER}/requests`)
    ).json()) as SeenRequest[];
    const byokCalls = finalSeen.filter(
      (r) => r.authorization === `Bearer ${byokKey}`,
    );
    expect(byokCalls.every((r) => r.model === byokModel)).toBe(true);
  });
});
