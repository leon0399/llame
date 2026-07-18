/**
 * Model-context transparency browser proof
 * (openspec/changes/model-specific-system-prompts task 8.5).
 *
 * Exercises the real authenticated browser, durable worker run, immutable
 * context receipt, and DB-backed chat-search projection. The compaction row is
 * seeded deterministically, then a third real turn forces the search projection
 * to rebuild after every hidden context artifact exists.
 */

import { expect, test } from "../fixtures";
import { seedCompaction } from "./seed-compaction";

const ANSWER = "Mocked answer from the e2e model server.";
const DEFAULT_MODEL_ID = "system:openai:gpt-5.4-mini";
const TARGET_MODEL_ID = "e2e:context-target-carmine";
const ORIGINAL_TEXT = "Remember e2eoriginaljuniper for the transparency proof.";
const COMPACTION_SUMMARY =
  "Generated checkpoint e2ecompactionlilac must stay out of chat search.";
const EXPECTED_TARGET_PROMPT = `# E2E context target

This complete model-specific prompt contains e2epromptcitrine.
You are E2E Context Target with public id ${TARGET_MODEL_ID}.`;
const TOOL_DESCRIPTION =
  "Search the user’s own chats by keyword (matches chat titles and message content). Use to recall something the user said before that is no longer in view. Returns short snippets; it only sees this user’s own chats.";

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;

type SearchResult = {
  id: string;
  title: string | null;
  snippet: string | null;
};

test.describe("model-context transparency (browser, full stack)", () => {
  test.setTimeout(90_000);

  test("surfaces a model switch and receipt without leaking hidden context into chat search", async ({
    page,
    account,
  }) => {
    await page.goto("/");

    const input = page.getByPlaceholder("What would you like to know?");
    await input.fill("Establish the first model turn.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("log").getByText(ANSWER)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, {
      timeout: 15_000,
    });

    const chatId = new URL(page.url()).pathname.split("/").pop();
    if (!chatId) {
      throw new Error(`Could not extract chat id from URL: ${page.url()}`);
    }

    // A terminal-run toast may overlay the bottom composer when background
    // monitoring reports this run. Follow its real action when present so it
    // cannot intercept the pointer-driven model picker; foreground completion
    // does not always emit the toast.
    const notifications = page.getByRole("region", {
      name: "Notifications alt+T",
    });
    const terminalRunView = notifications.getByRole("button", { name: "View" });
    if ((await terminalRunView.count()) > 0) {
      await terminalRunView.click();
    }

    const modelPicker = page.locator('button[role="combobox"]');
    await expect(modelPicker).toContainText(DEFAULT_MODEL_ID);
    await modelPicker.click();
    await page.getByRole("option", { name: "E2E Context Target" }).click();
    await expect(modelPicker).toContainText("E2E Context Target");
    await page.keyboard.press("Escape");
    await expect(page.getByPlaceholder("Search model...")).not.toBeVisible();

    await input.fill(ORIGINAL_TEXT);
    await input.press("Enter");
    await expect(page.getByRole("log").getByText(ANSWER).nth(1)).toBeVisible({
      timeout: 20_000,
    });

    const switchBoundary = page.getByRole("button", {
      name: `Model changed from ${DEFAULT_MODEL_ID} to ${TARGET_MODEL_ID}`,
    });
    await expect(switchBoundary).toBeVisible();

    const triggeringMessage = page.getByText(ORIGINAL_TEXT);
    await expect(triggeringMessage).toBeVisible();
    const triggeringMessageHandle = await triggeringMessage.elementHandle();
    if (!triggeringMessageHandle) {
      throw new Error(
        "Triggering user message disappeared before ordering check",
      );
    }
    expect(
      await switchBoundary.evaluate((boundary, message) => {
        let content = boundary.parentElement;
        while (content && !content.contains(message)) {
          content = content.parentElement;
        }
        if (!content || !content.closest('[role="log"]')) return false;

        const directChild = (element: Element): Element | null => {
          let current: Element | null = element;
          while (current?.parentElement && current.parentElement !== content) {
            current = current.parentElement;
          }
          return current?.parentElement === content ? current : null;
        };

        const boundaryBlock = directChild(boundary);
        const messageBlock = directChild(message);
        if (!boundaryBlock || !messageBlock) return false;

        const children = Array.from(content.children);
        return (
          children.indexOf(messageBlock) === children.indexOf(boundaryBlock) + 1
        );
      }, triggeringMessageHandle),
    ).toBe(true);

    await switchBoundary.click();
    await page.getByRole("button", { name: "View effective context" }).click();

    const receipt = page.getByRole("dialog", { name: "Effective context" });
    await expect(receipt).toBeVisible();
    await expect(
      receipt.getByRole("heading", { name: "Complete system prompt" }),
    ).toBeVisible();
    await expect(
      receipt
        .getByRole("heading", { name: "Complete system prompt" })
        .locator("..")
        .locator("pre"),
    ).toHaveText(EXPECTED_TARGET_PROMPT);

    const tool = receipt
      .getByRole("heading", { name: "search_conversations" })
      .locator("..");
    await expect(tool).toContainText(TOOL_DESCRIPTION);
    await expect(tool.locator("pre")).toContainText('"maxLength": 200');

    await page.keyboard.press("Escape");
    await expect(receipt).not.toBeVisible();

    const messagesResponse = await page.request.get(
      `${apiUrl}/api/v1/chats/${chatId}/messages`,
      { headers: { Authorization: `Bearer ${account.token}` } },
    );
    expect(messagesResponse.ok()).toBe(true);
    const { messages } = (await messagesResponse.json()) as {
      messages: Array<{ seq: number }>;
    };
    const uptoSeq = Math.max(...messages.map((message) => message.seq));
    seedCompaction(chatId, uptoSeq, COMPACTION_SUMMARY, undefined, account.id);

    // A subsequent real turn causes the post-commit search-index job to rebuild
    // this chat after the compaction, switch marker, prompt snapshot, and tool
    // declarations all exist.
    await input.fill("Reindex the completed transparency fixture.");
    await input.press("Enter");
    await expect(page.getByRole("log").getByText(ANSWER).nth(2)).toBeVisible({
      timeout: 20_000,
    });

    const search = async (query: string): Promise<SearchResult[]> => {
      const response = await page.request.get(
        `${apiUrl}/api/v1/chats/search?q=${encodeURIComponent(query)}`,
        { headers: { Authorization: `Bearer ${account.token}` } },
      );
      expect(response.ok()).toBe(true);
      return ((await response.json()) as { results: SearchResult[] }).results;
    };

    let originalResult: SearchResult | undefined;
    await expect
      .poll(
        async () => {
          originalResult = (await search("e2eoriginaljuniper")).find(
            (result) => result.id === chatId,
          );
          return originalResult?.id;
        },
        { timeout: 20_000 },
      )
      .toBe(chatId);

    expect(originalResult?.snippet).toContain("e2eoriginaljuniper");

    const hiddenSearchTerms = [
      "carmine", // server-generated switch reminder / marker ids
      "e2epromptcitrine", // complete system prompt
      "maxLength", // advertised tool input schema
      "e2ecompactionlilac", // generated compaction summary
    ] as const;
    for (const term of hiddenSearchTerms) {
      expect(await search(term), `${term} must not match chat search`).toEqual(
        [],
      );
      expect(originalResult?.snippet).not.toContain(term);
    }
  });
});
