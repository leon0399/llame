/**
 * Stop-from-submission browser proof (openspec/changes/run-cancellation M6).
 *
 * Holds a Run at the model server after the model request starts, asserts the
 * Thinking indicator and enabled Stop, clicks Stop, and waits for the hold to
 * close (client abort). Then polls until the Run is cancelled and the
 * persisted empty "stopped" turn appears via history adoption; reload shows
 * the same row.
 */

import { randomUUID } from "node:crypto";
import { expect, test } from "../../support/fixtures";

const MODEL_PORT = process.env.E2E_MODEL_PORT ?? "4303";
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;

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

type ActiveRun = { id: string; chatId: string; status: string };

function isActiveRun(value: unknown): value is ActiveRun {
  return (
    value !== null &&
    typeof value === "object" &&
    "id" in value &&
    "chatId" in value &&
    "status" in value &&
    typeof value.id === "string" &&
    typeof value.chatId === "string" &&
    typeof value.status === "string"
  );
}

type RunStatusResponse = { status: string };

function isRunStatusResponse(value: unknown): value is RunStatusResponse {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (!("status" in value)) {
    return false;
  }
  return typeof value.status === "string";
}

test.describe("stop from submission", () => {
  test.setTimeout(90_000);

  let activeHoldToken: string | undefined;

  test.afterEach(async () => {
    if (activeHoldToken === undefined) {
      return;
    }
    const token = activeHoldToken;
    activeHoldToken = undefined;
    await releaseHold(token);
  });

  test("Stop during a held model request settles cancelled and shows stopped", async ({
    page,
    account,
  }) => {
    const holdToken = `stop-${randomUUID()}`;
    activeHoldToken = holdToken;
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

    await expect(page.getByText("Thinking…")).toBeVisible({
      timeout: 15_000,
    });
    const stop = page.getByRole("button", { name: "Stop generation" });
    await expect(stop).toBeEnabled();

    const activeResponse = await page.request.get(
      `${API_URL}/api/v1/me/runs?status=active`,
      { headers: { Authorization: `Bearer ${account.token}` } },
    );
    expect(
      activeResponse.ok(),
      `list active runs failed with ${activeResponse.status()}`,
    ).toBe(true);
    const activeBody: unknown = await activeResponse.json();
    if (!Array.isArray(activeBody)) {
      throw new Error("active runs response is not an array");
    }
    const run = activeBody.find(
      (entry): entry is ActiveRun =>
        isActiveRun(entry) && entry.chatId === chatId,
    );
    if (run === undefined) {
      throw new Error(`no active run for chat ${chatId}`);
    }

    await stop.click();

    await expect
      .poll(async () => (await fetchHoldStatus(holdToken)).closed, {
        timeout: 30_000,
      })
      .toBe(true);
    activeHoldToken = undefined;

    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${API_URL}/api/v1/runs/${run.id}`,
            { headers: { Authorization: `Bearer ${account.token}` } },
          );
          if (!response.ok()) {
            return `http-${response.status()}`;
          }
          const body: unknown = await response.json();
          if (!isRunStatusResponse(body)) {
            return "malformed";
          }
          return body.status;
        },
        { timeout: 30_000 },
      )
      .toBe("cancelled");

    // History adoption brings the persisted empty turn; no reload yet.
    await expect(page.getByText(/^stopped/)).toBeVisible({
      timeout: 30_000,
    });

    await page.reload();
    await expect(page.getByText(/^stopped/)).toBeVisible({
      timeout: 20_000,
    });
  });
});
