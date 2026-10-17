/**
 * Message-target scroll (#1237).
 *
 * A `/chat/<id>#msg-N` open loads the history window ENDING at the target,
 * so the target is the newest loaded row and the transcript's ordinary bottom
 * pin already shows its end. The target scroll must instead land the row's
 * centre in view and keep it there against the stick-to-bottom pin — a
 * difference only a row taller than the viewport makes visible, which is the
 * case this spec builds. An ordinary open of the same Chat still lands at the
 * newest message.
 */

import { readyComposer } from "../../support/composer";
import { expect, test, type Page } from "../../support/fixtures";

const ANSWER = "Mocked answer from the e2e model server.";
// Enough paragraphs to make the first message several viewports tall.
const PARAGRAPHS = 60;
const tallPrompt = Array.from(
  { length: PARAGRAPHS },
  (_, index) => `Target scroll paragraph ${index + 1}.`,
).join("\n\n");

// Mirrors CHAT_SCROLLER_SELECTOR in
// apps/web/lib/services/chat/prehydration-pin.ts (the e2e island does not
// import app code).
const SCROLLER = '[role="log"] > div';

// Whether the row's vertical centre lies inside the transcript scroller's
// visible box. Bounding boxes, not Playwright visibility: a row taller than
// the viewport is "in the viewport" whether it shows its top, middle, or end.
function rowCentreInScroller(page: Page, selector: string) {
  return page.evaluate(
    ({ row, scrollerSelector }) => {
      const element = document.querySelector(row);
      const scroller = document.querySelector(scrollerSelector);
      if (!element || !scroller) return null;
      const box = element.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      const centre = (box.top + box.bottom) / 2;
      return centre >= view.top && centre <= view.bottom;
    },
    { row: selector, scrollerSelector: SCROLLER },
  );
}

// A landed target must STAY landed: the stick-to-bottom pin's writers (the
// library's content ResizeObserver, ChatLoadOlder's synchronous re-pin) run
// on later frames, after any single sample. Samples the row every animation
// frame until the scroller's geometry has held still for SETTLE_FRAMES
// consecutive frames (late Markdown/highlight growth restarts the count) and
// counts the frames in which the row's centre was outside the scroller.
const SETTLE_FRAMES = 60;
const MAX_FRAMES = 900;
function rowCentreStaysInScroller(page: Page, selector: string) {
  return page.evaluate(
    async ({ row, scrollerSelector, settleFrames, maxFrames }) => {
      let frames = 0;
      let stableFrames = 0;
      let framesOut = 0;
      let lastGeometry = "";
      while (stableFrames < settleFrames && frames < maxFrames) {
        await new Promise(requestAnimationFrame);
        frames += 1;
        const element = document.querySelector(row);
        const scroller = document.querySelector(scrollerSelector);
        if (!element || !scroller) {
          framesOut += 1;
          stableFrames = 0;
          continue;
        }
        const box = element.getBoundingClientRect();
        const view = scroller.getBoundingClientRect();
        const centre = (box.top + box.bottom) / 2;
        if (centre < view.top || centre > view.bottom) framesOut += 1;
        const geometry = `${scroller.scrollTop}:${scroller.scrollHeight}`;
        stableFrames = geometry === lastGeometry ? stableFrames + 1 : 0;
        lastGeometry = geometry;
      }
      return { settled: stableFrames >= settleFrames, framesOut };
    },
    {
      row: selector,
      scrollerSelector: SCROLLER,
      settleFrames: SETTLE_FRAMES,
      maxFrames: MAX_FRAMES,
    },
  );
}

function distanceFromBottom(page: Page) {
  return page.evaluate((scrollerSelector) => {
    const scroller = document.querySelector(scrollerSelector);
    if (!scroller) return null;
    return Math.round(
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
    );
  }, SCROLLER);
}

test.describe("message target scroll (#1237)", () => {
  test("a #msg-N open centres a tall target; an ordinary open pins to the newest", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await page.goto("/");
    await (await readyComposer(page)).fill(tallPrompt);
    await page.getByRole("button", { name: "Send message" }).click();
    const log = page.getByRole("log");
    await expect(log.getByText(ANSWER)).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/u, {
      timeout: 15_000,
    });
    const chatId = new URL(page.url()).pathname.split("/").at(-1);
    if (!chatId) throw new Error("chat id missing from URL");

    // The tall first message is the target: taller than the viewport, so the
    // bottom pin would show only its last paragraphs.
    const target = page.locator("#msg-1");
    const viewportHeight = page.viewportSize()?.height ?? 720;
    const targetHeight = (await target.boundingBox())?.height ?? 0;
    expect(targetHeight).toBeGreaterThan(2 * viewportHeight);

    // Full navigation from another page: a cold document, where the
    // transcript mounts only after the Markdown renderers load.
    await page.goto("/");
    await readyComposer(page);
    await page.goto(`/chat/${chatId}#msg-1`);
    await expect(target).toContainText("Target scroll paragraph 1.", {
      timeout: 15_000,
    });
    await expect
      .poll(() => rowCentreInScroller(page, "#msg-1"), { timeout: 10_000 })
      .toBe(true);
    expect(await rowCentreStaysInScroller(page, "#msg-1")).toEqual({
      settled: true,
      framesOut: 0,
    });

    // A reload of the targeted URL lands the same way.
    await page.reload();
    await expect(target).toContainText("Target scroll paragraph 1.", {
      timeout: 15_000,
    });
    await expect
      .poll(() => rowCentreInScroller(page, "#msg-1"), { timeout: 10_000 })
      .toBe(true);
    expect(await rowCentreStaysInScroller(page, "#msg-1")).toEqual({
      settled: true,
      framesOut: 0,
    });

    // An ordinary open of the same Chat still lands at the newest message.
    await page.goto(`/chat/${chatId}`);
    await expect(log.getByText(ANSWER)).toBeInViewport({ timeout: 15_000 });
    await expect
      .poll(() => distanceFromBottom(page), { timeout: 10_000 })
      .toBeLessThanOrEqual(5);
  });
});
