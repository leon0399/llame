/**
 * Vision attachments browser proof (openspec/changes/vision-media task 9.3).
 *
 * A pasted image uploads through `POST /api/v1/media`, rides the sent message
 * to a model declaring image input (the mock answers with the number of
 * images its request carried), survives a reload as a sent thumbnail, and
 * opens in the lightbox, whose toggle switches between the stored `model`
 * and `original` variants. A message carrying only an image, attached
 * through the file picker, sends the same way, and an owner fork of its chat
 * opens the same stored image in its own lightbox.
 */

import { expect, test, type Page } from "../../support/fixtures";

const DEFAULT_MODEL_ID = "system:openai:gpt-5.4-mini";
const VISION_MODEL_NAME = "E2E Vision";
const VISION_ANSWER = "Vision fixture saw 1 attached image.";
const IMAGE_NAME = "wide.png";
const IMAGE_ONLY_NAME = "image-only.png";
const LOCATOR = "media://[0-9a-f-]{36}";
const CHAT_URL = /\/chat\/[0-9a-f-]{36}$/;
const MODEL_SRC = /\/api\/v1\/media\/([0-9a-f-]{36})\/model$/;

async function selectVisionModel(page: Page): Promise<void> {
  // The client-fetched catalog is the hydration barrier (see
  // mcp-stdio-tool.spec.ts): the picker names the default model only once
  // the composer is live.
  const picker = page.getByRole("combobox", { name: "Select model" });
  await expect(picker).toContainText(DEFAULT_MODEL_ID);
  await picker.click();
  await page.getByRole("option", { name: VISION_MODEL_NAME }).click();
  await expect(picker).toContainText(VISION_MODEL_NAME);
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Search model...")).not.toBeVisible();
}

test("a pasted image reaches a vision model and opens in the lightbox after reload", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await selectVisionModel(page);

  const composer = page.getByPlaceholder("What would you like to know?");
  await expect(composer).toBeEditable();
  // A clipboard image paste: a 2400×600 PNG drawn in the page, so the model
  // variant (long edge bounded at 2000) differs from the original.
  await composer.evaluate(async (textarea, name) => {
    const canvas = new OffscreenCanvas(2400, 600);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2d context");
    context.fillStyle = "#e4e4e7";
    context.fillRect(0, 0, 2400, 600);
    context.fillStyle = "#18181b";
    context.fillRect(200, 150, 2000, 300);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([blob], name, { type: "image/png" }));
    textarea.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, IMAGE_NAME);
  await expect(
    page
      .getByRole("list", { name: "Attached images" })
      .getByRole("img", { name: IMAGE_NAME }),
  ).toBeVisible();

  await composer.fill("Describe the pasted image.");
  const send = page.getByRole("button", { name: "Send message" });
  // Send waits for the upload to finish.
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();

  const log = page.getByRole("log");
  await expect(log.getByText(VISION_ANSWER)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(CHAT_URL, { timeout: 15_000 });

  await page.reload();
  const thumbnail = log.getByRole("button", { name: IMAGE_NAME });
  await expect(thumbnail).toBeVisible({ timeout: 15_000 });
  await thumbnail.click();

  const lightbox = page.getByRole("dialog", { name: "Lightbox" });
  const shown = lightbox.locator(".yarl__slide_current img");
  await expect(
    lightbox.getByText(new RegExp(`^2000×500 PNG · upload · ${LOCATOR}$`)),
  ).toBeVisible();
  await expect(shown).toHaveAttribute("src", MODEL_SRC);

  await lightbox.getByRole("button", { name: "Original" }).click();
  await expect(
    lightbox.getByText(new RegExp(`^2400×600 PNG · upload · ${LOCATOR}$`)),
  ).toBeVisible();
  await expect(shown).toHaveAttribute(
    "src",
    /\/api\/v1\/media\/[0-9a-f-]{36}\/original$/,
  );
  // The route serves the stored original to the cookie-authenticated page.
  await expect
    .poll(() => shown.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(2400);

  await page.keyboard.press("Escape");
  await expect(lightbox).toBeHidden();
  await expect(thumbnail).toBeFocused();
});

test("an image-only message sends and opens the same image in an owner fork", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await selectVisionModel(page);

  const composer = page.getByPlaceholder("What would you like to know?");
  await expect(composer).toBeEditable();
  // A 1200×800 PNG drawn in the page: bytes distinct from the pasted image
  // above, so the worker account's per-owner deduplication never reuses it.
  const dataUrl = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(1200, 800);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2d context");
    context.fillStyle = "#dbeafe";
    context.fillRect(0, 0, 1200, 800);
    context.fillStyle = "#1e3a8a";
    context.fillRect(300, 200, 600, 400);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  });
  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach images" }).click();
  await (
    await fileChooser
  ).setFiles({
    name: IMAGE_ONLY_NAME,
    mimeType: "image/png",
    buffer: Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"),
  });
  await expect(
    page
      .getByRole("list", { name: "Attached images" })
      .getByRole("img", { name: IMAGE_ONLY_NAME }),
  ).toBeVisible();

  // No text: the message carries only the image.
  await expect(composer).toHaveValue("");
  const send = page.getByRole("button", { name: "Send message" });
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();

  const log = page.getByRole("log");
  await expect(log.getByText(VISION_ANSWER)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(CHAT_URL, { timeout: 15_000 });
  const sourceUrl = page.url();

  // Reload so the fork action targets the persisted message ids.
  await page.reload();
  const sourceThumbnail = log.getByRole("img", { name: IMAGE_ONLY_NAME });
  await expect(sourceThumbnail).toBeVisible({ timeout: 15_000 });
  const sourceSrc = await sourceThumbnail.getAttribute("src");
  const mediaId = MODEL_SRC.exec(sourceSrc ?? "")?.[1];
  if (mediaId === undefined) {
    throw new Error(`Thumbnail src is not a model variant: ${sourceSrc}`);
  }
  await expect(log.getByText(VISION_ANSWER)).toBeVisible();

  // Fork from the assistant answer: the fork copies the image-only message.
  await log.getByRole("button", { name: "Fork from here" }).last().click();
  await expect(page).not.toHaveURL(sourceUrl, { timeout: 15_000 });
  await expect(page).toHaveURL(CHAT_URL);

  const forkThumbnail = log.getByRole("button", { name: IMAGE_ONLY_NAME });
  await expect(forkThumbnail).toBeVisible({ timeout: 15_000 });
  await expect(log.getByText(VISION_ANSWER)).toBeVisible();
  await forkThumbnail.click();

  // The fork references the stored image, not a copy.
  const lightbox = page.getByRole("dialog", { name: "Lightbox" });
  await expect(
    lightbox.getByText(`1200×800 PNG · upload · media://${mediaId}`, {
      exact: true,
    }),
  ).toBeVisible();
  const shown = lightbox.locator(".yarl__slide_current img");
  await expect(shown).toHaveAttribute("src", sourceSrc ?? "");
  await expect
    .poll(() => shown.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1200);

  await page.keyboard.press("Escape");
  await expect(lightbox).toBeHidden();
  await expect(forkThumbnail).toBeFocused();
});
