/**
 * Personal Knowledge browser acceptance (OpenSpec tasks 3.1-3.2).
 *
 * The fixture uses one process-scoped operator root and provisions one stable
 * child per Playwright worker. Files are written directly into those children:
 * no Git checkout or index is involved, so the browser exercises live bytes.
 * The model fixture requests only the two code-owned Knowledge tools for the
 * prompts below; the ordinary generic tool renderer is the citation surface.
 */

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

import {
  expect,
  expectProtectedShell,
  loginViaUi,
  test,
  type TestAccount,
  type KnowledgeSpaceFixture,
} from "../../support/fixtures";

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;
const knowledgeRoot = process.env.E2E_KNOWLEDGE_ROOT;
const modelId = "system:openai:gpt-5.4-mini";

function requireKnowledgeRoot(): string {
  if (!knowledgeRoot) {
    throw new Error("E2E_KNOWLEDGE_ROOT is required for Knowledge acceptance");
  }
  return knowledgeRoot;
}

async function provisionKnowledgeSpace(
  request: APIRequestContext,
  account: TestAccount,
): Promise<KnowledgeSpaceFixture> {
  const response = await request.put(`${apiUrl}/api/v1/me/knowledge-space`, {
    headers: { Authorization: `Bearer ${account.token}` },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "string") {
    throw new Error("Knowledge provisioning returned no stable ID");
  }
  return {
    id: body.id,
    directory: path.join(requireKnowledgeRoot(), body.id),
  };
}

function writeNote(
  space: KnowledgeSpaceFixture,
  relativePath: string,
  content: string,
): void {
  const absolutePath = path.join(space.directory, ...relativePath.split("/"));
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  const composer = page.getByPlaceholder("What would you like to know?");
  await expect(composer).toBeEditable();
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
}

async function prepareChat(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("combobox", { name: "Select model" }),
  ).toContainText(modelId);
}

async function expectCompletedTool(
  log: Locator,
  toolName: string,
  expectedPath: string,
  occurrence = 0,
): Promise<void> {
  const card = log
    .getByRole("button")
    .filter({ hasText: toolName })
    .nth(occurrence);
  await expect(card).toContainText("Completed", { timeout: 30_000 });
  await card.click();
  await expect(card.locator("..")).toContainText(expectedPath);
}

async function expectErroredTool(
  log: Locator,
  expectedMessage: string,
  occurrence: number,
): Promise<void> {
  const card = log
    .getByRole("button")
    .filter({ hasText: "knowledge_read" })
    .nth(occurrence);
  await expect(card).toContainText("Error", { timeout: 30_000 });
  await card.click();
  await expect(card.locator("..")).toContainText(expectedMessage);
}

test.describe("personal Knowledge tools (browser, full stack)", () => {
  test("finds live notes, renders a relative-path citation, and sees a new file", async ({
    page,
    workerKnowledgeSpace,
  }) => {
    writeNote(
      workerKnowledgeSpace,
      "notes/worker-note.md",
      "# Worker note\n\nKNOWLEDGE_E2E_MARKER\n",
    );

    await prepareChat(page);
    await sendPrompt(
      page,
      "Please search the knowledge fixture and cite the note path.",
    );

    const log = page.getByRole("log");
    await expectCompletedTool(log, "knowledge_search", "notes/worker-note.md");
    await expect(
      log.getByText("I found the note at notes/worker-note.md."),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("body")).not.toContainText(
      requireKnowledgeRoot(),
    );

    // The file is changed outside Git and the next turn reads the current
    // directory, proving response-time filesystem authority and attribution.
    writeNote(
      workerKnowledgeSpace,
      "notes/new-note.md",
      "# New note\n\nKNOWLEDGE_E2E_CHANGED\n",
    );
    await sendPrompt(
      page,
      "Please search the knowledge changed fixture and cite the new note path.",
    );
    await expectCompletedTool(log, "knowledge_search", "notes/new-note.md", 1);
    await expect(
      log.getByText("I found the changed note at notes/new-note.md."),
    ).toBeVisible({ timeout: 30_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    const reloadedCard = log
      .getByRole("button")
      .filter({ hasText: "knowledge_search" })
      .last();
    await reloadedCard.click();
    await expect(reloadedCard.locator("..")).toContainText(
      "notes/new-note.md",
      {
        timeout: 15_000,
      },
    );
  });

  test("keeps identical note text tenant-scoped for two users", async ({
    browser,
    freshAccount,
    page,
    request,
    workerKnowledgeSpace,
  }) => {
    const freshSpace = await provisionKnowledgeSpace(request, freshAccount);
    rmSync(workerKnowledgeSpace.directory, { recursive: true, force: true });
    mkdirSync(workerKnowledgeSpace.directory, { recursive: true });
    rmSync(freshSpace.directory, { recursive: true, force: true });
    mkdirSync(freshSpace.directory, { recursive: true });

    const identical = "KNOWLEDGE_E2E_MARKER\nidentical text for both owners\n";
    writeNote(workerKnowledgeSpace, "notes/worker-note.md", identical);
    writeNote(workerKnowledgeSpace, "notes/only-worker.md", identical);
    writeNote(freshSpace, "notes/worker-note.md", identical);
    writeNote(freshSpace, "notes/only-fresh.md", identical);

    await prepareChat(page);
    await sendPrompt(
      page,
      "Please search the knowledge fixture and cite the note path.",
    );
    const workerLog = page.getByRole("log");
    await expectCompletedTool(
      workerLog,
      "knowledge_search",
      "notes/worker-note.md",
    );
    await expect(
      workerLog
        .getByRole("button")
        .filter({ hasText: "knowledge_search" })
        .first()
        .locator(".."),
    ).toContainText(workerKnowledgeSpace.id);
    await expect(workerLog).not.toContainText("only-fresh.md");
    await expect(workerLog).not.toContainText(freshSpace.id);

    const context = await browser.newContext({
      baseURL:
        process.env.NEXT_PUBLIC_WEB_URL ??
        `http://localhost:${process.env.E2E_WEB_PORT ?? "4300"}`,
    });
    const freshPage = await context.newPage();
    try {
      await freshPage.goto("/login");
      await loginViaUi(freshPage, freshAccount);
      await expectProtectedShell(freshPage, freshAccount);
      await prepareChat(freshPage);
      await sendPrompt(
        freshPage,
        "Please search the knowledge fixture and cite the note path.",
      );
      const freshLog = freshPage.getByRole("log");
      await expectCompletedTool(
        freshLog,
        "knowledge_search",
        "notes/worker-note.md",
      );
      await expect(
        freshLog
          .getByRole("button")
          .filter({ hasText: "knowledge_search" })
          .first()
          .locator(".."),
      ).toContainText(freshSpace.id);
      await expect(freshLog).not.toContainText("only-worker.md");
      await expect(freshLog).not.toContainText(workerKnowledgeSpace.id);
    } finally {
      await context.close();
    }

    expect(workerKnowledgeSpace.id).not.toBe(freshSpace.id);
  });

  test("returns safe failures for traversal, links, limits, and unavailable mounts", async ({
    page,
    workerKnowledgeSpace,
  }) => {
    rmSync(workerKnowledgeSpace.directory, { recursive: true, force: true });
    mkdirSync(workerKnowledgeSpace.directory, { recursive: true });
    writeNote(
      workerKnowledgeSpace,
      "notes/oversized.md",
      "x".repeat(65 * 1024),
    );
    const linkTargetRoot = mkdtempSync(path.join(tmpdir(), "llame-e2e-link-"));
    const linkTarget = path.join(linkTargetRoot, "secret.md");
    writeFileSync(linkTarget, "outside Knowledge root\n", "utf8");
    symlinkSync(
      linkTarget,
      path.join(workerKnowledgeSpace.directory, "notes/link.md"),
    );

    try {
      await prepareChat(page);
      const log = page.getByRole("log");

      await sendPrompt(page, "Please read the knowledge traversal fixture.");
      await expectErroredTool(log, "The Knowledge path is invalid.", 0);

      await sendPrompt(page, "Please read the knowledge symlink fixture.");
      await expectErroredTool(log, "The Knowledge path is invalid.", 1);

      await sendPrompt(page, "Please read the knowledge oversized fixture.");
      await expectErroredTool(
        log,
        "The Knowledge operation exceeded its limit.",
        2,
      );

      await sendPrompt(page, "Please read the knowledge missing fixture.");
      await expectErroredTool(log, "The Knowledge note was not found.", 3);

      // Acceptance still sees the configured API root, while the co-located
      // worker resolver fails closed when its owner child is unavailable.
      rmSync(workerKnowledgeSpace.directory, { recursive: true, force: true });
      await sendPrompt(page, "Please read the knowledge unavailable fixture.");
      await expectErroredTool(log, "The Knowledge Space is unavailable.", 4);

      // Missing-root and a separately mounted worker are covered by the
      // focused API integration, where the authoring candidate resolver and
      // worker runtime resolver can be instantiated with distinct roots.
    } finally {
      mkdirSync(requireKnowledgeRoot(), { recursive: true });
      mkdirSync(workerKnowledgeSpace.directory, { recursive: true });
      rmSync(linkTargetRoot, { recursive: true, force: true });
    }
  });
});
