/**
 * Windowed chat history browser e2e (#187).
 *
 * A chat far larger than one history page must open bottom-up on just the
 * newest window (no eager multi-page walk), land the reader at the newest
 * message, and load strictly-older pages endlessly as the reader scrolls
 * toward the top — holding the reading position steady across each prepend.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures";
import { seedMessages } from "./seed-messages";

const ANSWER = "Mocked answer from the e2e model server.";
const SEEDED_COUNT = 130;
// The chat's 2 real messages + the seeded rows.
const TOTAL_MESSAGES = 2 + SEEDED_COUNT;
const WINDOW = 100;
const WHEEL_STEP = 800;

// Scroll geometry of the transcript's scroller (`Conversation` renders
// role="log" on the StickToBottom root; its first child is the scrollable
// element). Mirrors CHAT_SCROLLER_SELECTOR in
// apps/web/lib/services/chat/prehydration-pin.ts — kept as a literal because
// the e2e island does not import app code.
function scrollerState(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('[role="log"] > div');
    if (!scroller) return null;
    return {
      top: Math.round(scroller.scrollTop),
      fromBottom: Math.round(
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
      ),
    };
  });
}

// The topmost message intersecting the viewport, as {key, top}. Bounding
// boxes, not Playwright visibility — `toBeVisible` means "in the DOM and not
// hidden", which every loaded message satisfies regardless of scrolling.
function topmostInViewport(page: Page) {
  return page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>(
      "[data-message-key]",
    )) {
      const box = element.getBoundingClientRect();
      if (box.bottom > 0 && box.top < window.innerHeight) {
        return { key: element.dataset.messageKey ?? "", top: box.top };
      }
    }
    return null;
  });
}

function topOfMessage(page: Page, key: string) {
  return page.evaluate((wanted) => {
    const element = document.querySelector<HTMLElement>(
      `[data-message-key="${CSS.escape(wanted)}"]`,
    );
    return element ? element.getBoundingClientRect().top : null;
  }, key);
}

test.describe("chat history pagination (#187)", () => {
  test("opens on the newest window and loads older pages on upward scroll", async ({
    page,
    account,
  }) => {
    test.setTimeout(120_000);

    // Create a real chat through the app, then grow it far past one page.
    await page.goto("/");
    await page
      .getByPlaceholder("What would you like to know?")
      .fill("history pagination first turn");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("log").getByText(ANSWER)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/, {
      timeout: 15_000,
    });
    const chatId = new URL(page.url()).pathname.split("/").at(-1);
    if (!chatId) throw new Error("chat id missing from URL");

    seedMessages(chatId, SEEDED_COUNT, account.id);

    await page.reload();
    const log = page.getByRole("log");
    const messages = page.locator("[data-message-key]");

    // Bottom-up: the newest seeded turn is in the initial window and the view
    // settles at the very bottom without any scrolling…
    await expect(log.getByText(`seeded turn ${SEEDED_COUNT}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(async () => (await scrollerState(page))?.fromBottom, {
        timeout: 10_000,
      })
      .toBeLessThanOrEqual(5);
    // …and only the newest window was loaded — not the whole chat.
    await expect(messages).toHaveCount(WINDOW);
    await expect(log.getByText("history pagination first turn")).toHaveCount(0);

    // Wheel upward in small steps (real user scrolling — it also releases
    // stick-to-bottom). Older pages must load as the top approaches, WITHOUT
    // yanking the reading position: after every step, the message that was
    // topmost on screen may move down by roughly the step size (plus prepend
    // compensation slack), never by a whole page's height.
    await log.hover();
    let sawPrepend = false;
    let lastCount = await messages.count();
    for (let step = 0; step < 300; step++) {
      const state = await scrollerState(page);
      if (state !== null && state.top <= 0 && lastCount >= TOTAL_MESSAGES) {
        break;
      }

      const before = await topmostInViewport(page);
      await page.mouse.wheel(0, -WHEEL_STEP);
      // Give the wheel, a possible page fetch, and the prepend a beat.
      await page.waitForTimeout(120);

      const count = await messages.count();
      if (count > lastCount) sawPrepend = true;
      lastCount = count;

      if (before && before.key.length > 0) {
        const after = await topOfMessage(page, before.key);
        if (after !== null) {
          const drift = after - before.top;
          expect(
            drift,
            "prepend must not yank the reading position",
          ).toBeLessThan(WHEEL_STEP + 2000);
          expect(drift).toBeGreaterThan(-WHEEL_STEP - 200);
        }
      }
    }

    // The walk reached the chat's true start: at least one page prepended,
    // every message is loaded, the chat's first message is actually on
    // screen, and the loader control removed itself.
    expect(sawPrepend).toBe(true);
    await expect(messages).toHaveCount(TOTAL_MESSAGES);
    const firstTop = await page.evaluate(() => {
      const element = document.querySelector("[data-message-key]");
      return element ? element.getBoundingClientRect().top : null;
    });
    const viewportHeight = page.viewportSize()?.height ?? 720;
    if (firstTop === null) throw new Error("first message not rendered");
    expect(firstTop).toBeGreaterThan(-100);
    expect(firstTop).toBeLessThan(viewportHeight);
    await expect(page.getByTestId("chat-load-older")).toHaveCount(0);
  });
});
