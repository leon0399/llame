import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The chat composer once the page can accept a turn (#350). `ChatPage` renders
 * nothing until its message target resolves, and the composer then remounts
 * when the markdown renderer finishes loading (`key={disabled ? "locked" :
 * "ready"}`), discarding a value typed before the flip; `toBeEditable()` waits
 * past that remount. The model selector names a real model only once the
 * models query resolved, so waiting on it also guarantees that Send is enabled
 * for a filled prompt. Its loading and failure labels are excluded, so a failed
 * catalog fetch fails here rather than as a later click timeout.
 */
export async function readyComposer(page: Page): Promise<Locator> {
  await expect(
    page.getByRole("combobox", {
      name: /^Select model, (?!Select a model$|Models unavailable$)/,
    }),
  ).toBeVisible();
  const composer = page.getByPlaceholder("What would you like to know?");
  await expect(composer).toBeEditable();
  return composer;
}
