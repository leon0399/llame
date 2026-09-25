/**
 * Toast placement browser proof (openspec/changes/run-cancellation M6).
 *
 * Holds a Run at the model server, remounts the active-run provider on `/`,
 * then completes so a "Reply ready" toast appears. At desktop and mobile
 * viewports the toast must not intersect the composer; its View action is
 * followed.
 */

import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "../../support/fixtures";

const MODEL_PORT = process.env.E2E_MODEL_PORT ?? "4303";
const ANSWER = "Mocked answer from the e2e model server.";

type HoldStatus = { arrived: boolean; closed: boolean };

function holdBaseUrl(token: string): string {
  return `http://localhost:${MODEL_PORT}/hold/${token}`;
}

function isHoldStatus(value: unknown): value is HoldStatus {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (!("arrived" in value) || !("closed" in value)) {
    return false;
  }
  return (
    typeof value.arrived === "boolean" && typeof value.closed === "boolean"
  );
}

async function fetchHoldStatus(token: string): Promise<HoldStatus> {
  const response = await fetch(holdBaseUrl(token));
  if (!response.ok) {
    throw new Error(`hold status HTTP ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isHoldStatus(body)) {
    throw new Error(`hold status malformed: ${JSON.stringify(body)}`);
  }
  return body;
}

async function releaseHold(token: string): Promise<void> {
  const response = await fetch(`${holdBaseUrl(token)}/release`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`hold release HTTP ${response.status}`);
  }
}

function boxesIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

async function openMobileChatSheet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
}

async function closeMobileChatSheet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
}

async function waitForProcessingSidebar(
  page: Page,
  chatId: string,
  mobile: boolean,
): Promise<void> {
  if (mobile) {
    await openMobileChatSheet(page);
  }
  const row = page.locator(`a[href="/chat/${chatId}"]`);
  await expect(row.getByLabel("Generating response")).toBeVisible({
    timeout: 20_000,
  });
  if (mobile) {
    await closeMobileChatSheet(page);
  }
}

const VIEWPORTS = [
  { name: "1280x720", width: 1280, height: 720, mobile: false },
  { name: "390x844", width: 390, height: 844, mobile: true },
] as const;

for (const viewport of VIEWPORTS) {
  test.describe(`toast placement (${viewport.name})`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
    });
    test.setTimeout(90_000);

    test("background Reply ready toast clears the composer", async ({
      page,
    }) => {
      const holdToken = `toast-${randomUUID()}`;
      const heldPrompt = `HOLD:${holdToken} please answer when released`;

      await page.goto("/");
      const input = page.getByPlaceholder("What would you like to know?");
      await input.fill(heldPrompt);
      await page.getByRole("button", { name: "Send message" }).click();

      await expect
        .poll(async () => (await fetchHoldStatus(holdToken)).arrived, {
          timeout: 30_000,
        })
        .toBe(true);

      await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, {
        timeout: 15_000,
      });
      const chatPath = new URL(page.url()).pathname;
      const chatId = chatPath.split("/").pop();
      if (chatId === undefined) {
        throw new Error(`Could not extract chat id from ${page.url()}`);
      }

      // Full navigation remounts ActiveRunsProvider; held Run has no start
      // frame yet, so tracking comes only from rehydration.
      await page.goto("/");

      await waitForProcessingSidebar(page, chatId, viewport.mobile);

      await releaseHold(holdToken);

      const notifications = page.getByRole("region", {
        name: "Notifications alt+T",
      });
      const toast = notifications
        .locator("[data-sonner-toast]")
        .filter({ hasText: /Reply ready/ });
      await expect(toast).toBeVisible({ timeout: 30_000 });

      // Hover pauses Sonner's dismiss timer while we measure boxes.
      await toast.hover();
      const toastBox = await toast.boundingBox();
      const composer = page
        .locator("form")
        .filter({ has: page.getByPlaceholder("What would you like to know?") });
      const composerBox = await composer.boundingBox();
      expect(toastBox).not.toBeNull();
      expect(composerBox).not.toBeNull();
      if (toastBox === null || composerBox === null) {
        throw new Error("missing bounding box for toast or composer");
      }
      expect(boxesIntersect(toastBox, composerBox)).toBe(false);

      await toast.getByRole("button", { name: "View" }).click();
      await expect(page).toHaveURL(new RegExp(`${chatPath}$`), {
        timeout: 15_000,
      });
      await expect(page.getByRole("log").getByText(ANSWER)).toBeVisible({
        timeout: 20_000,
      });
    });
  });
}
