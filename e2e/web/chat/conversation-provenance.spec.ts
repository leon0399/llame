/**
 * Product proof for canonical conversation provenance (OpenSpec task 4.1).
 *
 * The source Chat is intentionally created through the browser, while its
 * stable sequence is obtained through the owner API. The model fixture's
 * unique prompt then performs search_conversations → conversation_read using
 * the returned coordinates. A giant multi-part source belongs in the queued
 * Postgres acceptance suite; this browser test stays focused on the user
 * surface, generic tool chips, replay, and pasted owner links.
 */

import {
  expect,
  hasStableId,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "../../support/fixtures";

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;
const modelId = "system:openai:gpt-5.4-mini";
const sourceMarker = "E2E_EPISODIC_SOURCE_MARKER";
const recallPrompt =
  "Please recall my episodic provenance e2e source and read it exactly.";
const sourceLines = [
  `Owner evidence ${sourceMarker}: the deployment decision is preserved.`,
  "The first bounded read includes this adjacent line.",
  "The continuation begins on this third line.",
  "The continuation preserves this terminal line.",
] as const;
const sourceText = sourceLines.join("\n");
const answer = "I read the canonical episodic source exactly.";

type ApiMessage = {
  seq: number;
  role: string;
  parts: Array<{ type?: unknown; text?: unknown }>;
};

function isApiMessage(value: unknown): value is ApiMessage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (
    "seq" in value &&
    typeof value.seq === "number" &&
    "role" in value &&
    typeof value.role === "string" &&
    "parts" in value &&
    Array.isArray(value.parts)
  );
}

function isTextPart(part: {
  type?: unknown;
  text?: unknown;
}): part is { type: "text"; text: string } {
  return part.type === "text" && typeof part.text === "string";
}

async function readMessages(response: APIResponse): Promise<Array<ApiMessage>> {
  // SAFETY: this is the api's own chat-messages endpoint (under test here),
  // whose { messages: [...] } envelope is fixed by its own OpenAPI contract.
  const body = (await response.json()) as { messages?: unknown };
  return Array.isArray(body.messages) ? body.messages.filter(isApiMessage) : [];
}

async function messageContaining(
  request: APIRequestContext,
  token: string,
  chatId: string,
  marker: string,
): Promise<ApiMessage> {
  const response = await request.get(
    `${apiUrl}/api/v1/chats/${chatId}/messages`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(response.ok()).toBe(true);
  const messages = await readMessages(response);
  const source = messages.find((message) =>
    message.parts.some(
      (part) => isTextPart(part) && part.text.includes(marker),
    ),
  );
  if (!source) throw new Error(`Owner API did not return message: ${marker}`);
  expect(Number.isSafeInteger(source.seq)).toBe(true);
  expect(source.seq).toBeGreaterThan(0);
  return source;
}

async function send(page: Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder("What would you like to know?");
  await expect(composer).toBeEditable();
  await composer.fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

test.describe("conversation provenance (browser, full stack)", () => {
  test.setTimeout(90_000);

  test("searches, reads, reloads, and opens an owner message target", async ({
    account,
    freshAccount,
    page,
    request,
  }) => {
    await page.goto("/");
    await send(page, sourceText);
    await expect(
      page
        .getByRole("log")
        .getByText("Mocked answer from the e2e model server."),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/u, {
      timeout: 15_000,
    });

    const sourceChatId = new URL(page.url()).pathname.split("/").at(-1);
    if (!sourceChatId) throw new Error("Source Chat id missing from URL");
    const source = await messageContaining(
      request,
      account.token,
      sourceChatId,
      sourceMarker,
    );
    expect(source.seq).toBe(1);

    // Root creates a fresh destination Chat. The fixture model recognizes only
    // this exact natural-language marker, so existing ordinary chat prompts
    // retain the answer-only behavior.
    await page.goto("/");
    await send(page, recallPrompt);
    const log = page.getByRole("log");
    const searchTool = log
      .getByRole("button")
      .filter({ hasText: "search_conversations" });
    const readTools = log
      .getByRole("button")
      .filter({ hasText: "conversation_read" });
    await expect(searchTool).toHaveCount(1);
    await expect(readTools).toHaveCount(2);
    await expect(searchTool).toContainText("Completed", { timeout: 30_000 });
    await expect(readTools.nth(0)).toContainText("Completed", {
      timeout: 30_000,
    });
    await expect(readTools.nth(1)).toContainText("Completed", {
      timeout: 30_000,
    });
    await expect(log.getByText(answer)).toBeVisible({ timeout: 30_000 });

    // The only presentation is the existing generic structured-tool renderer;
    // this feature adds no copy-link/source card/activity/outline affordance.
    await expect(page.getByRole("button", { name: /copy link/i })).toHaveCount(
      0,
    );
    await expect(page.getByText(/activity timeline|outline/i)).toHaveCount(0);

    const destinationChatId = new URL(page.url()).pathname.split("/").at(-1);
    if (!destinationChatId)
      throw new Error("Destination Chat id missing from URL");
    const destinationPrompt = await messageContaining(
      request,
      account.token,
      destinationChatId,
      recallPrompt,
    );
    expect(destinationPrompt.seq).toBe(1);

    await readTools.nth(0).click();
    await expect(readTools.nth(0).locator("..")).toContainText(
      `1: ${sourceLines[0]}`,
    );
    await readTools.nth(1).click();
    await expect(readTools.nth(1).locator("..")).toContainText(
      `3: ${sourceLines[2]}`,
    );

    // Full reload reconstructs both persisted call/result pairs through the
    // ordinary tool parts. No source rehydration is allowed on this path.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      log.getByRole("button").filter({ hasText: "search_conversations" }),
    ).toHaveCount(1);
    await expect(
      log.getByRole("button").filter({ hasText: "conversation_read" }),
    ).toHaveCount(2);
    await expect(log.getByText(answer)).toBeVisible({ timeout: 15_000 });
    const reloadedReadTools = log
      .getByRole("button")
      .filter({ hasText: "conversation_read" });
    await reloadedReadTools.nth(0).click();
    await expect(reloadedReadTools.nth(0).locator("..")).toContainText(
      `1: ${sourceLines[0]}`,
    );
    await reloadedReadTools.nth(1).click();
    await expect(reloadedReadTools.nth(1).locator("..")).toContainText(
      `3: ${sourceLines[2]}`,
    );

    const forkResponse = await request.post(
      `${apiUrl}/api/v1/chats/${sourceChatId}/forks`,
      {
        headers: { Authorization: `Bearer ${account.token}` },
        data: {},
      },
    );
    expect(forkResponse.status()).toBe(201);
    const forkBody: unknown = await forkResponse.json();
    if (!hasStableId(forkBody)) {
      throw new Error("Fork response did not contain a Chat id");
    }
    const forkMessagesResponse = await request.get(
      `${apiUrl}/api/v1/chats/${forkBody.id}/messages`,
      { headers: { Authorization: `Bearer ${account.token}` } },
    );
    expect(forkMessagesResponse.ok()).toBe(true);
    const forkMessages = await readMessages(forkMessagesResponse);
    expect(forkMessages.map((message) => message.seq)).toEqual([1, 2]);

    const foreignChatId = crypto.randomUUID();
    const foreignCreate = await request.post(
      `${apiUrl}/api/v1/chats/${foreignChatId}/messages`,
      {
        headers: { Authorization: `Bearer ${freshAccount.token}` },
        data: {
          modelId,
          message: {
            id: crypto.randomUUID(),
            parts: [{ type: "text", text: "Foreign target evidence." }],
          },
        },
      },
    );
    expect(foreignCreate.ok()).toBe(true);
    const foreignTarget = await request.get(
      `${apiUrl}/api/v1/chats/${foreignChatId}/messages?limit=100&targetSeq=1`,
      { headers: { Authorization: `Bearer ${account.token}` } },
    );
    expect(foreignTarget.status()).toBe(404);

    // Paste the owner-issued sequence URL. The target route must load the
    // source message by opaque sequence, not by the position in a page array.
    await page.goto(`/chat/${sourceChatId}#msg-${source.seq}`);
    const target = page.locator(`#msg-${source.seq}`);
    await expect(target).toHaveCount(1, { timeout: 15_000 });
    await target.scrollIntoViewIfNeeded();
    await expect(target).toContainText(sourceMarker);
    await expect(page).toHaveURL(`/chat/${sourceChatId}#msg-${source.seq}`);

    await page.reload({ waitUntil: "domcontentloaded" });
    const reloadedTarget = page.locator(`#msg-${source.seq}`);
    await expect(reloadedTarget).toHaveCount(1, { timeout: 15_000 });
    await expect(reloadedTarget).toContainText(sourceMarker);
    await expect(page).toHaveURL(`/chat/${sourceChatId}#msg-${source.seq}`);

    // Keep the destination id live in the test's evidence so the preceding
    // reload assertion cannot accidentally pass against a stale route.
    expect(destinationChatId).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
