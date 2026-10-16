import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "../../support/fixtures";

const PDF_NAME = "paper.pdf";
const PDF_BYTES = readFileSync(
  resolve(
    __dirname,
    "../../../apps/api/src/media/testing/pdf/fifteen-pages.pdf",
  ),
);
const ORIGINAL_URL = /\/api\/v1\/media\/[0-9a-f-]{36}\/original$/;

// The native PDF viewer requires full Chromium rather than headless shell.
test.use({ channel: "chromium" });

test("a PDF reaches a PDF-only model and opens its original after reload", async ({
  page,
}) => {
  const imageRequests: Array<string> = [];
  page.on("request", (request) => {
    if (/\/api\/v1\/media\/[0-9a-f-]{36}\/model$/.test(request.url())) {
      imageRequests.push(request.url());
    }
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const model = page.getByRole("combobox", { name: "Select model" });
  await expect(model).toContainText("system:openai:gpt-5.4-mini");
  await model.click();
  await page.getByRole("option", { name: "E2E PDF" }).click();
  await expect(model).toContainText("E2E PDF");
  await page.keyboard.press("Escape");

  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files" }).click();
  await (
    await fileChooser
  ).setFiles({
    name: PDF_NAME,
    mimeType: "application/pdf",
    buffer: PDF_BYTES,
  });
  const composing = page.getByRole("list", { name: "Attachments" });
  await expect(composing.getByText(PDF_NAME)).toBeVisible();
  await expect(
    composing.getByRole("link", { name: `Open ${PDF_NAME} in a new tab` }),
  ).toBeVisible();

  await page
    .getByPlaceholder("What would you like to know?")
    .fill("Summarize the attached PDF.");
  const send = page.getByRole("button", { name: "Send message" });
  await expect(send).toBeEnabled();
  await send.click();
  const log = page.getByRole("log");
  await expect(log.getByText("PDF fixture saw 1 attached PDF.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);

  await page.reload();
  const originalLink = log.getByRole("link", {
    name: `Open ${PDF_NAME} in a new tab`,
  });
  await expect(originalLink).toBeVisible();
  await expect(originalLink).toHaveAttribute("href", ORIGINAL_URL);
  await expect(originalLink).toHaveAttribute("target", "_blank");
  await expect(
    log.getByRole("list", { name: "Attachments" }).getByText(PDF_NAME),
  ).toBeVisible();
  await expect(
    log.getByRole("list", { name: "Attachments" }).getByRole("img"),
  ).toHaveCount(0);

  const originalUrl = await originalLink.evaluate(
    (anchor: HTMLAnchorElement) => anchor.href,
  );
  const original = await page.request.get(originalUrl);
  expect(original.headers()["content-type"]).toContain("application/pdf");
  expect(await original.body()).toEqual(PDF_BYTES);

  const opened = page.waitForEvent("popup");
  await originalLink.click();
  const viewer = await opened;
  await expect(viewer).toHaveURL(originalUrl);
  await viewer.close();
  await expect(page.getByRole("dialog", { name: PDF_NAME })).toHaveCount(0);
  expect(imageRequests).toEqual([]);
});
