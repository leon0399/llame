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
  hasStableId,
  loginViaUi,
  revokeKnowledgeSpaceFixtureAccess,
  test,
  type TestAccount,
  type KnowledgeSpaceFixture,
} from "../../support/fixtures";

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;
const knowledgeRoot = process.env.E2E_KNOWLEDGE_ROOT;
const modelId = "system:openai:gpt-5.4-mini";
const longNotePath = "notes/long-note.md";
const pagedQuery = "KNOWLEDGE_E2E_PAGED";

type KnowledgeSpaceResponse = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

function requireKnowledgeRoot(): string {
  if (!knowledgeRoot) {
    throw new Error("E2E_KNOWLEDGE_ROOT is required for Knowledge acceptance");
  }
  return knowledgeRoot;
}

async function provisionKnowledgeSpace(
  request: APIRequestContext,
  account: TestAccount,
  name = "Personal",
): Promise<KnowledgeSpaceFixture> {
  mkdirSync(requireKnowledgeRoot(), { recursive: true });
  const response = await request.post(`${apiUrl}/api/v1/knowledge-spaces`, {
    headers: { Authorization: `Bearer ${account.token}` },
    data: { name },
  });
  if (!response.ok()) {
    throw new Error(
      `Knowledge provisioning failed: ${response.status()} ${await response.text()}`,
    );
  }
  const body: unknown = await response.json();
  if (!hasStableId(body)) {
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
  test("creates, lists, retrieves, and renames duplicate-named spaces without cross-account leakage", async ({
    account,
    freshAccount,
    request,
  }) => {
    const first = await provisionKnowledgeSpace(request, account, "Duplicate");
    const second = await provisionKnowledgeSpace(request, account, "Duplicate");
    expect(first.id).not.toBe(second.id);

    const listResponse = await request.get(
      `${apiUrl}/api/v1/knowledge-spaces?limit=100`,
      { headers: { Authorization: `Bearer ${account.token}` } },
    );
    expect(listResponse.ok()).toBe(true);
    // SAFETY: this is the api's own knowledge-spaces list endpoint (under
    // test here), whose paginated-collection response shape is fixed by its
    // own OpenAPI contract.
    const collection = (await listResponse.json()) as {
      items: Array<KnowledgeSpaceResponse>;
      nextCursor: string | null;
    };
    expect(collection.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, name: "Duplicate" }),
        expect.objectContaining({ id: second.id, name: "Duplicate" }),
      ]),
    );

    const getResponse = await request.get(
      `${apiUrl}/api/v1/knowledge-spaces/${second.id}`,
      { headers: { Authorization: `Bearer ${account.token}` } },
    );
    expect(getResponse.ok()).toBe(true);
    await expect(getResponse.json()).resolves.toMatchObject({
      id: second.id,
      name: "Duplicate",
    });

    const renameResponse = await request.patch(
      `${apiUrl}/api/v1/knowledge-spaces/${second.id}`,
      {
        headers: { Authorization: `Bearer ${account.token}` },
        data: { name: "Renamed" },
      },
    );
    expect(renameResponse.ok()).toBe(true);
    await expect(renameResponse.json()).resolves.toMatchObject({
      id: second.id,
      name: "Renamed",
    });

    for (const method of ["get", "patch"] as const) {
      const response = await request[method](
        `${apiUrl}/api/v1/knowledge-spaces/${second.id}`,
        {
          headers: { Authorization: `Bearer ${freshAccount.token}` },
          data: method === "patch" ? { name: "Stolen" } : undefined,
        },
      );
      expect(response.status()).toBe(404);
      const body = await response.text();
      expect(body).not.toContain(account.id);
      expect(body).not.toContain(second.directory);
    }

    const foreignList = await request.get(
      `${apiUrl}/api/v1/knowledge-spaces?limit=100`,
      { headers: { Authorization: `Bearer ${freshAccount.token}` } },
    );
    expect(foreignList.ok()).toBe(true);
    expect(await foreignList.text()).not.toContain(first.id);
    expect(await foreignList.text()).not.toContain(second.id);
  });

  test("searches current spaces, uses explicit read IDs, and observes additions and revocation", async ({
    account,
    page,
    request,
    workerKnowledgeSpace,
  }) => {
    const second = await provisionKnowledgeSpace(request, account, "Projects");
    writeNote(
      workerKnowledgeSpace,
      "notes/worker-note.md",
      "KNOWLEDGE_E2E_MARKER from Personal\n",
    );
    writeNote(
      second,
      "notes/worker-note.md",
      "KNOWLEDGE_E2E_MARKER from Projects\n",
    );

    await prepareChat(page);
    await sendPrompt(
      page,
      "Please search the knowledge fixture across all spaces.",
    );
    const log = page.getByRole("log");
    const allSpacesCard = log
      .getByRole("button")
      .filter({ hasText: "knowledge_search" })
      .first();
    await expect(allSpacesCard).toContainText("Completed", { timeout: 30_000 });
    await allSpacesCard.click();
    await expect(allSpacesCard.locator("..")).toContainText(
      workerKnowledgeSpace.id,
    );
    await expect(allSpacesCard.locator("..")).toContainText(second.id);

    await sendPrompt(
      page,
      `Please search the explicit knowledge fixture. Knowledge Space ID: ${second.id}`,
    );
    await expectCompletedTool(
      log,
      "knowledge_search",
      "notes/worker-note.md",
      1,
    );
    const explicitSearchCard = log
      .getByRole("button")
      .filter({ hasText: "knowledge_search" })
      .nth(1);
    await expect(explicitSearchCard.locator("..")).toContainText(second.id);
    await expect(explicitSearchCard.locator("..")).not.toContainText(
      workerKnowledgeSpace.id,
    );

    await sendPrompt(
      page,
      `Please read the knowledge fixture. Knowledge Space ID: ${second.id}`,
    );
    await expectCompletedTool(log, "knowledge_read", "notes/worker-note.md");
    const readCard = log
      .getByRole("button")
      .filter({ hasText: "knowledge_read" })
      .first();
    await expect(readCard.locator("..")).toContainText(second.id);

    const added = await provisionKnowledgeSpace(request, account, "Added live");
    writeNote(
      added,
      "notes/new-note.md",
      "KNOWLEDGE_E2E_CHANGED from a later space\n",
    );
    writeNote(added, "notes/worker-note.md", "read before revocation\n");
    await sendPrompt(
      page,
      "Please search the knowledge changed fixture across all current spaces.",
    );
    await expectCompletedTool(log, "knowledge_search", "notes/new-note.md", 2);
    const addedSearchCard = log
      .getByRole("button")
      .filter({ hasText: "knowledge_search" })
      .nth(2);
    await expect(addedSearchCard.locator("..")).toContainText(added.id);

    await sendPrompt(
      page,
      `Please read the knowledge fixture. Knowledge Space ID: ${added.id}`,
    );
    await expectCompletedTool(log, "knowledge_read", "notes/worker-note.md", 1);
    revokeKnowledgeSpaceFixtureAccess(account.id, added.id);
    await sendPrompt(
      page,
      `Please read the knowledge fixture. Knowledge Space ID: ${added.id}`,
    );
    await expectErroredTool(log, "Knowledge Space was not found.", 2);

    await page.reload({ waitUntil: "domcontentloaded" });
    const reloadedSearch = log
      .getByRole("button")
      .filter({ hasText: "knowledge_search" })
      .nth(2);
    await reloadedSearch.click();
    await expect(reloadedSearch.locator("..")).toContainText(added.id);
    await expect(reloadedSearch.locator("..")).toContainText(
      "notes/new-note.md",
    );
  });

  test("returns usable all-space results with an incomplete warning", async ({
    account,
    page,
    request,
    workerKnowledgeSpace,
  }) => {
    writeNote(
      workerKnowledgeSpace,
      "notes/worker-note.md",
      "KNOWLEDGE_E2E_MARKER from a healthy space\n",
    );
    const broken = await provisionKnowledgeSpace(request, account, "Broken");
    rmSync(broken.directory, { recursive: true, force: true });

    await prepareChat(page);
    await sendPrompt(
      page,
      "Please search the knowledge fixture across all spaces.",
    );
    const card = page
      .getByRole("log")
      .getByRole("button")
      .filter({ hasText: "knowledge_search" })
      .first();
    await expect(card).toContainText("Completed", { timeout: 30_000 });
    await card.click();
    const details = card.locator("..");
    await expect(details).toContainText("notes/worker-note.md");
    await expect(details).toContainText(/"complete":\s*false/u);
    await expect(details).toContainText("knowledge_space_unavailable");
    await expect(details).toContainText(broken.id);
  });

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

  test("navigates long notes with ranges and paged literal passages", async ({
    account,
    page,
    request,
  }) => {
    const rangedSpace = await provisionKnowledgeSpace(
      request,
      account,
      "Ranged acceptance",
    );
    const longNote = Array.from({ length: 2005 }, (_, index) => {
      if (index === 2) return `${pagedQuery} first passage`;
      if (index === 1102) return `${pagedQuery} second passage`;
      if (index === 2002) return `${pagedQuery} final passage`;
      return "x";
    }).join("\n");
    writeNote(rangedSpace, longNotePath, `${longNote}\n`);

    await prepareChat(page);
    const log = page.getByRole("log");

    await sendPrompt(
      page,
      `Please read the long knowledge fixture. Knowledge Space ID: ${rangedSpace.id}`,
    );
    const firstRead = log
      .getByRole("button")
      .filter({ hasText: "knowledge_read" })
      .first();
    await expect(firstRead).toContainText("Completed", { timeout: 30_000 });
    await firstRead.click();
    const firstReadDetails = firstRead.locator("..");
    await expect(firstReadDetails).toContainText(longNotePath);
    await expect(firstReadDetails).toContainText('"offset": 0');
    await expect(firstReadDetails).toContainText('"nextOffset":');
    await expect(firstReadDetails).toContainText('"cutReason":');
    await expect(firstReadDetails).not.toContainText("contentHash");
    await expect(firstReadDetails).not.toContainText("expectedContentHash");
    await expect(firstReadDetails).not.toContainText(requireKnowledgeRoot());

    const continuedRead = log
      .getByRole("button")
      .filter({ hasText: "knowledge_read" })
      .nth(1);
    await expect(continuedRead).toContainText("Completed", {
      timeout: 30_000,
    });
    await continuedRead.click();
    const continuedReadDetails = continuedRead.locator("..");
    await expect(continuedReadDetails).toContainText(longNotePath);
    await expect(continuedReadDetails).toContainText('"offset":');
    await expect(continuedReadDetails).toContainText('"limit": 2000');
    await expect(continuedReadDetails).toContainText(
      "KNOWLEDGE_E2E_PAGED final",
    );
    await expect(continuedReadDetails).not.toContainText("contentHash");
    await expect(continuedReadDetails).not.toContainText("expectedContentHash");

    await sendPrompt(
      page,
      `Please read an explicit range from the long knowledge fixture. Knowledge Space ID: ${rangedSpace.id}`,
    );
    const explicitRead = log
      .getByRole("button")
      .filter({ hasText: "knowledge_read" })
      .nth(2);
    await expect(explicitRead).toContainText("Completed", { timeout: 30_000 });
    await explicitRead.click();
    const explicitReadDetails = explicitRead.locator("..");
    await expect(explicitReadDetails).toContainText(longNotePath);
    await expect(explicitReadDetails).toContainText('"offset": 2');
    await expect(explicitReadDetails).toContainText('"limit": 3');
    await expect(explicitReadDetails).toContainText("3: KNOWLEDGE_E2E_PAGED");
    await expect(explicitReadDetails).not.toContainText("contentHash");
    await expect(explicitReadDetails).not.toContainText(requireKnowledgeRoot());

    await sendPrompt(
      page,
      `Please search the knowledge fixture for the paged literal passages. Knowledge Space ID: ${rangedSpace.id}`,
    );
    const firstSearch = log
      .getByRole("button")
      .filter({ hasText: "knowledge_search" })
      .first();
    await expect(firstSearch).toContainText("Completed", { timeout: 30_000 });
    await firstSearch.click();
    const firstSearchDetails = firstSearch.locator("..");
    await expect(firstSearchDetails).toContainText(longNotePath);
    await expect(firstSearchDetails).toContainText(rangedSpace.id);
    await expect(firstSearchDetails).toContainText('"limit": 1');
    await expect(firstSearchDetails).toContainText('"offset": 1');
    await expect(firstSearchDetails).toContainText(
      "KNOWLEDGE_E2E_PAGED first passage",
    );
    await expect(firstSearchDetails).not.toContainText("contentHash");
    await expect(firstSearchDetails).not.toContainText("expectedContentHash");
    await expect(firstSearchDetails).not.toContainText(requireKnowledgeRoot());

    const secondSearch = log
      .getByRole("button")
      .filter({ hasText: "knowledge_search" })
      .nth(1);
    await expect(secondSearch).toContainText("Completed", { timeout: 30_000 });
    await secondSearch.click();
    const secondSearchDetails = secondSearch.locator("..");
    await expect(secondSearchDetails).toContainText(longNotePath);
    await expect(secondSearchDetails).toContainText('"cursor":');
    await expect(secondSearchDetails).toContainText('"limit": 1');
    await expect(secondSearchDetails).toContainText('"offset": 1101');
    await expect(secondSearchDetails).toContainText(
      "KNOWLEDGE_E2E_PAGED second passage",
    );
    await expect(secondSearchDetails).not.toContainText("contentHash");
    await expect(secondSearchDetails).not.toContainText("expectedContentHash");
    await expect(secondSearchDetails).not.toContainText(requireKnowledgeRoot());

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("log")).toContainText(longNotePath);
    await expect(page.getByRole("log")).not.toContainText(
      requireKnowledgeRoot(),
    );

    // Resource authorization is resolved for every tool call, not retained
    // from the successful calls above. The next explicit read must fail after
    // this current Knowledge Space binding is removed.
    revokeKnowledgeSpaceFixtureAccess(account.id, rangedSpace.id);
    await sendPrompt(
      page,
      `Please read the long knowledge fixture after access was revoked. Knowledge Space ID: ${rangedSpace.id}`,
    );
    await expectErroredTool(log, "Knowledge Space was not found.", 3);
  });

  test("keeps identical note text tenant-scoped for two users", async ({
    browser,
    freshAccount,
    page,
    request,
    workerKnowledgeSpace,
  }, testInfo) => {
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
      locale: testInfo.project.use.locale,
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

      await sendPrompt(
        page,
        `Please read the knowledge traversal fixture. Knowledge Space ID: ${workerKnowledgeSpace.id}`,
      );
      await expectErroredTool(log, "The Knowledge path is invalid.", 0);

      await sendPrompt(
        page,
        `Please read the knowledge symlink fixture. Knowledge Space ID: ${workerKnowledgeSpace.id}`,
      );
      await expectErroredTool(log, "The Knowledge path is invalid.", 1);

      await sendPrompt(
        page,
        `Please read the knowledge oversized fixture. Knowledge Space ID: ${workerKnowledgeSpace.id}`,
      );
      await expectErroredTool(
        log,
        "The Knowledge operation exceeded its limit.",
        2,
      );

      await sendPrompt(
        page,
        `Please read the knowledge missing fixture. Knowledge Space ID: ${workerKnowledgeSpace.id}`,
      );
      await expectErroredTool(log, "The Knowledge note was not found.", 3);

      // Acceptance still sees the configured API root, while the co-located
      // worker resolver fails closed when its owner child is unavailable.
      rmSync(workerKnowledgeSpace.directory, { recursive: true, force: true });
      await sendPrompt(
        page,
        `Please read the knowledge unavailable fixture. Knowledge Space ID: ${workerKnowledgeSpace.id}`,
      );
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
