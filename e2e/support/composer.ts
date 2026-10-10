import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The chat composer once the page can accept a turn (#350). The server-rendered
 * textbox is editable before hydration, and a `fill()` that lands before React
 * hydrates is discarded when the controlled input remounts, so the following
 * click sends an empty prompt. The model selector names its selection only
 * after the client hydrated and its models query resolved, which makes it a
 * barrier for both.
 */
export async function readyComposer(page: Page): Promise<Locator> {
  await expect(
    page.getByRole("combobox", { name: /^Select model, / }),
  ).toBeVisible();
  const composer = page.getByPlaceholder("What would you like to know?");
  await expect(composer).toBeEditable();
  return composer;
}
