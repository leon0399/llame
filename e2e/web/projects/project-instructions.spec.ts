/**
 * Project instructions product e2e (openspec `project-discovery`, task 5.3).
 *
 * Runs the real web, api, worker, and PostgreSQL path, and inspects the exact
 * completion request the api sends the deterministic mock provider. The model
 * server holds the request (`HOLD:<token>`) so the test can read the body the
 * provider received rather than a client-side echo or a system-only receipt.
 *
 * The same test proves the editor's save and clear: instructions saved through
 * the Project page survive a reload, appear literally in a new Project Chat's
 * first model request with the Project's `projects://` locator, and after
 * clearing, a later Project Chat's request states the absence and contains none
 * of the retired text.
 */

import { randomUUID } from "node:crypto";

import { readyComposer } from "../../support/composer";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
  type TestAccount,
} from "../../support/fixtures";

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;

const modelUrl = `http://localhost:${process.env.E2E_MODEL_PORT ?? "4303"}`;

const ANSWER = "Mocked answer from the e2e model server.";

type ProjectRow = {
  id: string;
  instructions: string | null;
};

function ownerHeaders(account: TestAccount) {
  return { Authorization: `Bearer ${account.token}` };
}

/** The owner API's body, or a failure naming the call that produced it. */
async function body<T>(response: APIResponse, label: string): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${label}: ${response.status()} ${await response.text()}`);
  }

  // SAFETY: T is the api's own documented body for the route the caller named
  // in `label`, and the status check above admitted only a success response.
  return (await response.json()) as T;
}

async function createProject(
  request: APIRequestContext,
  account: TestAccount,
  label: string,
): Promise<ProjectRow> {
  return body<ProjectRow>(
    await request.post(`${apiUrl}/api/v1/projects`, {
      headers: ownerHeaders(account),
      data: { name: `E2E instructions ${label}` },
    }),
    "create project",
  );
}

async function readProject(
  request: APIRequestContext,
  account: TestAccount,
  projectId: string,
): Promise<ProjectRow> {
  return body<ProjectRow>(
    await request.get(`${apiUrl}/api/v1/projects/${projectId}`, {
      headers: ownerHeaders(account),
    }),
    "read project",
  );
}

type HoldStatus = {
  arrived: boolean;
  closed: boolean;
  /** The raw completion request body once the provider request arrived. */
  requestBody?: string;
};

function isHoldStatus(value: unknown): value is HoldStatus {
  if (value === null || typeof value !== "object") return false;

  if (!("arrived" in value) || !("closed" in value)) return false;

  return (
    typeof value.arrived === "boolean" &&
    typeof value.closed === "boolean" &&
    (!("requestBody" in value) || typeof value.requestBody === "string")
  );
}

async function holdStatus(token: string): Promise<HoldStatus> {
  const response = await fetch(`${modelUrl}/hold/${token}`);

  if (!response.ok) {
    throw new Error(`hold status ${token}: HTTP ${response.status}`);
  }

  const value: unknown = await response.json();

  if (!isHoldStatus(value)) {
    throw new Error(`hold status ${token} was malformed`);
  }

  return value;
}

async function releaseHold(token: string): Promise<void> {
  const response = await fetch(`${modelUrl}/hold/${token}/release`, {
    method: "POST",
  });

  expect(response.ok).toBe(true);
}

type CompletionRequest = { messages: ReadonlyArray<unknown> };

type RequestMessage = { content?: unknown };

type RequestTextPart = { text: string };

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isTextPart(value: unknown): value is RequestTextPart {
  return (
    value !== null &&
    typeof value === "object" &&
    "text" in value &&
    typeof value.text === "string"
  );
}

function isCompletionRequest(value: unknown): value is CompletionRequest {
  return (
    value !== null &&
    typeof value === "object" &&
    "messages" in value &&
    Array.isArray(value.messages)
  );
}

function isRequestMessage(value: unknown): value is RequestMessage {
  return value !== null && typeof value === "object";
}

/** A message's text, whether the provider sent one string or text parts. */
function messageText(content: unknown): ReadonlyArray<string> {
  if (isText(content)) return [content];

  if (!Array.isArray(content)) return [];

  const texts: Array<string> = [];

  for (const part of content) {
    if (isTextPart(part)) texts.push(part.text);
  }

  return texts;
}

/**
 * The Project context item carrying `guidance`, found among the parsed message
 * texts. Fails when no single item contains the literal guidance between the
 * instruction fences.
 */
function projectInstructionItem(
  strings: ReadonlyArray<string>,
  guidance: string,
): string {
  const item = strings.find(
    (text) =>
      text.includes("<project_instructions>") &&
      text.includes("</project_instructions>") &&
      text.includes(guidance),
  );

  if (item === undefined) {
    throw new Error(
      `provider request carried no Project instruction item for "${guidance}"`,
    );
  }

  expect(item.indexOf(guidance)).toBeGreaterThan(
    item.indexOf("<project_instructions>"),
  );
  expect(item.indexOf(guidance)).toBeLessThan(
    item.indexOf("</project_instructions>"),
  );

  return item;
}

/** Every message-content string in the provider request, parsed as JSON. */
function requestStrings(raw: string): ReadonlyArray<string> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("held request body was not JSON");
  }

  if (!isCompletionRequest(parsed)) {
    throw new Error("held request body had no message list");
  }

  const strings: Array<string> = [];

  for (const message of parsed.messages) {
    if (!isRequestMessage(message)) continue;

    strings.push(...messageText(message.content));
  }

  return strings;
}

/** Poll the fixture until it has captured the held request's raw body. */
async function heldRequestStrings(
  token: string,
): Promise<ReadonlyArray<string>> {
  await expect
    .poll(async () => (await holdStatus(token)).arrived, { timeout: 30_000 })
    .toBe(true);

  const status = await holdStatus(token);

  if (status.requestBody === undefined) {
    throw new Error(`hold ${token} arrived without a captured request body`);
  }

  return requestStrings(status.requestBody);
}

/**
 * Send a held prompt from the Project page, which files the new Chat into the
 * Project, and return every string the provider request contained.
 */
async function sendHeldProjectMessage(
  page: Page,
  token: string,
): Promise<ReadonlyArray<string>> {
  const input = await readyComposer(page);
  await input.fill(`HOLD:${token} answer with the project guidance in mind`);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 15_000 });

  return heldRequestStrings(token);
}

test.describe("Project instructions", () => {
  test.setTimeout(120_000);

  test("saved guidance reaches a new Project Chat, and clearing retires it", async ({
    page,
    request,
    account,
  }) => {
    // The project's name and the instruction marker are independent, so a
    // cleared-instructions assertion cannot match the still-present name.
    const marker = `E2E-GUIDANCE-${randomUUID()}`;
    const instructions = `Always begin with ${marker}. Keep the answer to one sentence.`;

    const project = await createProject(
      request,
      account,
      `E2E-PROJECT-${randomUUID()}`,
    );

    const projectUrl = `/projects/${project.id}`;

    const dialog = page.getByRole("dialog", { name: "Project instructions" });

    const editor = dialog.getByRole("textbox", {
      name: "Project instructions",
    });

    const save = dialog.getByRole("button", { name: "Save" });

    const settings = page.getByRole("complementary", {
      name: "Project settings",
    });

    // The section's card holds stored instructions; with none it offers to
    // add them. Either opens the editor dialog.
    const openEditor = async () => {
      await settings
        .getByRole("button", { name: /^(Edit|Add) instructions/ })
        .click();
      await expect(editor).toBeVisible();
    };

    const tokens: Array<string> = [];

    const newToken = (label: string): string => {
      const token = `${label}-${randomUUID()}`;
      tokens.push(token);

      return token;
    };

    try {
      await page.goto(projectUrl);
      await openEditor();
      await expect(editor).toHaveValue("");

      // Save through the real editor. The PATCH is the persistence proof; the
      // reload below proves the page reads it back from the api.
      const firstSave = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/projects/${project.id}`) &&
          response.request().method() === "PATCH",
        { timeout: 30_000 },
      );

      await editor.fill(instructions);
      await save.click();

      expect((await firstSave).status()).toBe(200);
      await expect(dialog).toBeHidden();

      await page.reload();
      await openEditor();
      await expect(editor).toHaveValue(instructions);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      expect(
        (await readProject(request, account, project.id)).instructions,
      ).toBe(instructions);

      // A new Project Chat. Whatever the editor saved must reach the provider
      // as part of this Run's first request, beside the Project locator.
      const firstToken = newToken("first");
      const firstStrings = await sendHeldProjectMessage(page, firstToken);

      expect(projectInstructionItem(firstStrings, instructions)).toContain(
        `projects://${project.id}`,
      );

      await releaseHold(firstToken);
      await expect(page.getByRole("log").getByText(ANSWER)).toBeVisible({
        timeout: 30_000,
      });

      // Clear by saving an empty draft, as the editor's contract defines it.
      await page.goto(projectUrl);
      await openEditor();
      await expect(editor).toHaveValue(instructions);

      const clearSave = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/projects/${project.id}`) &&
          response.request().method() === "PATCH",
        { timeout: 30_000 },
      );

      await editor.fill("");
      await save.click();

      expect((await clearSave).status()).toBe(200);
      await expect(dialog).toBeHidden();

      await page.reload();
      await expect(
        settings.getByRole("button", { name: /^Add instructions/ }),
      ).toBeVisible();

      expect(
        (await readProject(request, account, project.id)).instructions,
      ).toBe(null);

      // The next Project Chat retains its affiliation but carries none of the
      // cleared literal guidance.
      const secondToken = newToken("second");
      const secondStrings = await sendHeldProjectMessage(page, secondToken);
      const secondRequest = secondStrings.join("\n");

      expect(secondRequest).toContain(`projects://${project.id}`);
      expect(secondRequest).not.toContain(marker);

      await releaseHold(secondToken);
      await expect(page.getByRole("log").getByText(ANSWER)).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await Promise.all(
        tokens.map((token) => releaseHold(token).catch(() => undefined)),
      );
    }
  });
});
