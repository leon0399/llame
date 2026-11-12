/**
 * Esc browser proof (openspec/changes/in-run-steering, "Esc twice stops
 * everything").
 *
 * Holds a Run at the model server, queues a message through the Send menu,
 * types a draft, and presses Esc. With no `steer` item pending, Esc cancels the
 * Run: the model request closes, the queued message stays pending under a
 * "Paused" label, and the draft is untouched. The first Esc of the scenario,
 * which interrupts a pending steer, needs interrupt admission and is covered by
 * the `EscTwiceStopsEverything` story until that layer lands.
 */

import { randomUUID } from "node:crypto";
import { readyComposer } from "../../support/composer";
import { expect, test } from "../../support/fixtures";

const MODEL_PORT = process.env.E2E_MODEL_PORT ?? "4303";

function holdUrl(token: string, suffix = ""): string {
  return `http://localhost:${MODEL_PORT}/hold/${token}${suffix}`;
}

type HoldStatus = { arrived: boolean; closed: boolean };

function isHoldStatus(value: unknown): value is HoldStatus {
  return (
    value !== null &&
    typeof value === "object" &&
    "arrived" in value &&
    "closed" in value &&
    typeof value.arrived === "boolean" &&
    typeof value.closed === "boolean"
  );
}

async function holdState(token: string): Promise<HoldStatus> {
  const response = await fetch(holdUrl(token));

  if (!response.ok) {
    throw new Error(`hold status HTTP ${response.status}`);
  }

  const body: unknown = await response.json();

  if (!isHoldStatus(body)) {
    throw new Error(`hold status malformed: ${JSON.stringify(body)}`);
  }

  return body;
}

test.describe("Esc during a Run", () => {
  test.setTimeout(90_000);

  let activeHoldToken: string | undefined;

  test.afterEach(async () => {
    if (activeHoldToken === undefined) {
      return;
    }

    const token = activeHoldToken;
    activeHoldToken = undefined;
    await fetch(holdUrl(token, "/release"), { method: "POST" });
  });

  test("Esc cancels the Run and leaves the queued message paused", async ({
    page,
  }) => {
    const holdToken = `esc-${randomUUID()}`;
    activeHoldToken = holdToken;

    await page.goto("/");
    const input = await readyComposer(page);
    await input.fill(`HOLD:${holdToken} please answer when released`);
    await page.getByRole("button", { name: "Send message" }).click();

    await expect
      .poll(async () => (await holdState(holdToken)).arrived, {
        timeout: 30_000,
      })
      .toBe(true);
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 15_000 });
    await expect(page.getByText("Thinking…")).toBeVisible({ timeout: 15_000 });

    // The Run is active: Send is the split button, and Queue is its own choice.
    await input.fill("queued while the Run works");
    await page.getByRole("button", { name: "More ways to send" }).click();
    await page.getByRole("menuitem", { name: /Queue/ }).click();
    const stack = page.getByRole("region", { name: "Pending messages" });
    await expect(stack.getByText("queued while the Run works")).toBeVisible();

    await input.fill("my unsent draft");
    // The Escape guard also sees hidden popups during their exit animation.
    await expect(page.getByRole("menu", { includeHidden: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(
      0,
    );
    await input.press("Escape");

    await expect
      .poll(async () => (await holdState(holdToken)).closed, {
        timeout: 30_000,
      })
      .toBe(true);
    activeHoldToken = undefined;

    await expect(stack.getByText(/^Paused/)).toBeVisible({ timeout: 30_000 });
    await expect(stack.getByText("queued while the Run works")).toBeVisible();
    await expect(input).toHaveValue("my unsent draft");
  });
});
