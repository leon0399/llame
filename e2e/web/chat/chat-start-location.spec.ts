/**
 * Chat-start location browser e2e (openspec `chat-start-location`, design
 * D10/D11, tasks 6.1-6.4 and 6b.5).
 *
 * Every case runs against the full stack: Next.js web, the NestJS api on the
 * throwaway database, deterministic mock model, and a real throwaway git clone
 * on this host, registered through `POST /api/v1/checkouts` as the owner's
 * checkout. The project composer and the two sidebar entries then create filed,
 * bound chats exactly as the operator would, through the working-directory
 * pill beside `+`.
 *
 * Two Machine states cannot be produced by a suite with no remote host:
 *
 * - An offline Machine is a declared Machine (`e2e-offline`) that never
 *   answers, so the hub records it offline and the create refuses it.
 * - An outdated daemon is a daemon whose protocol lacks the typed git methods.
 *   It has no local double, so the last case answers the create request with
 *   the documented `machine_update_required` status (`page.route`) and proves
 *   only the client's response to it: the sentence, the disabled daemon, and
 *   the kept draft. The server's own statuses are covered by the API suites.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readyComposer } from "../../support/composer";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
  type TestAccount,
} from "../../support/fixtures";
import { runSeedSql } from "../../support/seed-sql";

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;
const OFFICE_MACHINE = "e2e-offline";
const MACHINE_OFFLINE = `machine:${OFFICE_MACHINE}`;
const PROJECT_TITLE = "E2E start location";
const ANSWER = "Mocked answer from the e2e model server.";

type ProjectRow = { id: string; name: string };
type CheckoutRow = {
  id: string;
  repositoryId: string;
  executorId: string;
  path: string;
  kind: "main" | "worktree";
  branch: string | null;
  chatIds: Array<string>;
};
type ChatRow = {
  id: string;
  projectId: string | null;
  workspaceRoot: string | null;
};

/** A project the owner started from, with its one registered checkout. */
type StartedProject = {
  project: ProjectRow;
  checkout: CheckoutRow;
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

/**
 * A throwaway clone with one commit and an `origin` remote, so registering it
 * adopts a repository instead of leaving the owner without a catalog row. Each
 * test owns its clone, so parallel workers never share a checkout.
 */
function createClone(label: string): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), `llame-e2e-${label}-`),
  );
  const git = (...args: Array<string>) =>
    execFileSync("git", args, { cwd: directory, stdio: "ignore" });
  git("init", "-b", "main");
  git("config", "user.email", "e2e@llame.test");
  git("config", "user.name", "llame e2e");
  fs.writeFileSync(path.join(directory, "README.md"), `# ${label}\n`);
  git("add", "README.md");
  git("commit", "-m", "Initial commit");
  git("remote", "add", "origin", `https://example.test/llame/${label}.git`);
  return directory;
}

/** A project whose single linked repository has one local main checkout. */
async function startProject(
  request: APIRequestContext,
  account: TestAccount,
  label: string,
): Promise<StartedProject> {
  const project = await body<ProjectRow>(
    await request.post(`${apiUrl}/api/v1/projects`, {
      headers: ownerHeaders(account),
      data: { name: `${PROJECT_TITLE} ${label}` },
    }),
    "create project",
  );
  const checkout = await body<CheckoutRow>(
    await request.post(`${apiUrl}/api/v1/checkouts`, {
      headers: ownerHeaders(account),
      data: { path: createClone(label) },
    }),
    "register checkout",
  );
  await body(
    await request.post(`${apiUrl}/api/v1/projects/${project.id}/repositories`, {
      headers: ownerHeaders(account),
      data: {
        repositoryId: checkout.repositoryId,
        alias: "llame",
        isPrimary: true,
      },
    }),
    "link repository",
  );
  return { project, checkout };
}

/** A filed, bound chat with no message, so no Run has to answer. */
async function createFiledChat(
  request: APIRequestContext,
  account: TestAccount,
  started: StartedProject,
): Promise<ChatRow> {
  return body<{ chat: ChatRow }>(
    await request.post(`${apiUrl}/api/v1/chats`, {
      headers: ownerHeaders(account),
      data: {
        id: randomUUID(),
        projectId: started.project.id,
        repositoryId: started.checkout.repositoryId,
        executorId: started.checkout.executorId,
        checkoutId: started.checkout.id,
      },
    }),
    "create chat",
  ).then((response) => response.chat);
}

async function readChat(
  request: APIRequestContext,
  account: TestAccount,
  chatId: string,
): Promise<ChatRow> {
  return body<ChatRow>(
    await request.get(`${apiUrl}/api/v1/chats/${chatId}`, {
      headers: ownerHeaders(account),
    }),
    "read chat",
  );
}

/** A pill cell, named `<cell>, <value>`; its value is a prefix of the name. */
function pillCell(page: Page, cell: "Machine" | "Folder" | "Work in") {
  return page.getByRole("button", { name: new RegExp(`^${cell}, `) });
}

/** The last path segment, which is how the folder cell names a checkout. */
function folderOf(checkoutPath: string): string {
  return path.basename(checkoutPath);
}

test.describe("chat start location (browser, full stack)", () => {
  test.setTimeout(120_000);

  test("the project composer creates a filed, bound chat", async ({
    page,
    request,
    account,
  }) => {
    const started = await startProject(request, account, "send");

    await page.goto(`/projects/${started.project.id}`);
    // The project's primary link pre-fills the pill; the send names it.
    await expect(pillCell(page, "Folder")).toHaveAccessibleName(
      `Folder, ${folderOf(started.checkout.path)}`,
    );

    const composer = await readyComposer(page);
    await composer.fill("Start from the project page");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/u, {
      timeout: 30_000,
    });
    await expect(page.getByRole("log").getByText(ANSWER)).toBeVisible({
      timeout: 30_000,
    });

    const chatId = new URL(page.url()).pathname.split("/").at(-1) ?? "";

    const chat = await readChat(request, account, chatId);
    expect(chat.projectId).toBe(started.project.id);
    expect(chat.workspaceRoot).toBe(started.checkout.path);
  });

  test("a worktree start binds a new worktree of the clone", async ({
    page,
    request,
    account,
  }) => {
    const started = await startProject(request, account, "worktree");

    await page.goto(`/projects/${started.project.id}`);
    await pillCell(page, "Work in").click();
    await page.getByRole("menuitemradio", { name: /^A new worktree/ }).click();
    await expect(pillCell(page, "Work in")).toHaveAccessibleName(
      "Work in, a new worktree",
    );

    const composer = await readyComposer(page);
    await composer.fill("Start in a worktree of this clone");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/u, {
      timeout: 30_000,
    });
    const chatId = new URL(page.url()).pathname.split("/").at(-1) ?? "";

    const worktrees = await body<Array<CheckoutRow>>(
      await request.get(
        `${apiUrl}/api/v1/checkouts?repositoryId=${started.checkout.repositoryId}`,
        { headers: ownerHeaders(account) },
      ),
      "list checkouts",
    );
    // The server names the worktree; the chat binds it and owns its lease.
    const worktree = worktrees.find((row) => row.chatIds.includes(chatId));
    expect(worktree?.kind).toBe("worktree");
    // The placement rule puts it beside the clone, never inside it.
    expect(worktree?.path).toContain("/.llame-worktrees/");
    const chat = await readChat(request, account, chatId);
    expect(chat.workspaceRoot).toBe(worktree?.path);
  });

  test("an offline Machine is disabled, and a create naming it keeps the draft", async ({
    page,
    request,
    account,
  }) => {
    const started = await startProject(request, account, "offline");
    // The declared Machine never answers, but its checkout is a row like any
    // other, so the Machine level offers it and the create can name it.
    runSeedSql(
      `INSERT INTO checkouts (owner_user_id, repository_id, executor_id, path, kind, branch, origin) VALUES ('${account.id}', '${started.checkout.repositoryId}', '${MACHINE_OFFLINE}', '${MACHINE_OFFLINE}/srv/src/llame-e2e', 'main', 'main', 'registered');`,
      account.id,
    );

    // The deep link pre-fills the offline Machine, which is how the pill and
    // the create see it without a click on a disabled option.
    await page.goto(
      `/chat/new?project=${started.project.id}&repository=${started.checkout.repositoryId}&executor=${MACHINE_OFFLINE}`,
    );
    await expect(page).toHaveURL(
      new RegExp(`/projects/${started.project.id}\\?`),
    );

    await expect(pillCell(page, "Machine")).toHaveAccessibleName(
      `Machine, ${OFFICE_MACHINE}`,
    );
    await pillCell(page, "Machine").click();
    await expect(
      page.getByRole("menuitemradio", {
        name: new RegExp(`^${OFFICE_MACHINE}: Offline`),
      }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");

    const draft = "Keep this draft when the Machine is offline";
    const composer = await readyComposer(page);
    await composer.fill(draft);
    await page.getByRole("button", { name: "Send message" }).click();

    // The route announcer is a second live region on every page, so the
    // failure sentence is what scopes this to the composer's alert.
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: `The executor ${MACHINE_OFFLINE} is offline.` }),
    ).toBeVisible();
    await expect(composer).toHaveValue(draft);
    // The failed create keeps the deep link's pre-fill in the query, so the
    // project page is the destination and the query is not part of the claim.
    await expect(page).toHaveURL(
      new RegExp(`/projects/${started.project.id}(?:\\?|$)`),
    );
  });

  test("an outdated daemon shows its warning and keeps the draft", async ({
    page,
    request,
    account,
  }) => {
    const started = await startProject(request, account, "outdated");
    // The Machine cell lists an executor only while it holds a `main` checkout
    // of the repository, so the daemon needs a row of its own for the disabled
    // option to be observable. The path is distinct from the offline case's:
    // (owner, executor, path) is unique, and both tests share the worker's
    // account when they land in one worker.
    runSeedSql(
      `INSERT INTO checkouts (owner_user_id, repository_id, executor_id, path, kind, branch, origin) VALUES ('${account.id}', '${started.checkout.repositoryId}', '${MACHINE_OFFLINE}', '${MACHINE_OFFLINE}/srv/src/llame-e2e-outdated', 'main', 'main', 'registered');`,
      account.id,
    );
    const daemonWarning =
      "Update the llame-machine daemon on that Machine to use git operations.";
    // No local double can answer an outdated protocol, so the create answers
    // the status the hub produces for a daemon without the typed git methods.
    await page.route("**/api/v1/chats", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      // SAFETY: this is the create request the composer just sent, whose `id`
      // is required by the request DTO.
      const sent = route.request().postDataJSON() as { id: string };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          chat: { id: sent.id, projectId: started.project.id },
          workspace: {
            status: "machine_update_required",
            executorId: MACHINE_OFFLINE,
            message: daemonWarning,
          },
        }),
      });
    });

    await page.goto(
      `/projects/${started.project.id}?repository=${started.checkout.repositoryId}&executor=${MACHINE_OFFLINE}`,
    );
    const draft = "Keep this draft for an outdated daemon";
    const composer = await readyComposer(page);
    await composer.fill(draft);
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: daemonWarning }),
    ).toBeVisible();
    await expect(composer).toHaveValue(draft);
    await pillCell(page, "Machine").click();
    await expect(
      page.getByRole("menuitemradio", {
        name: new RegExp(`^${OFFICE_MACHINE}: Update the llame-machine`),
      }),
    ).toBeDisabled();
  });

  test("the sidebar entries pre-fill the composer's pill", async ({
    page,
    request,
    account,
  }) => {
    const started = await startProject(request, account, "entries");
    const chat = await createFiledChat(request, account, started);

    // "New chat here" copies the source chat's project, repository, executor,
    // and checkout, and turns isolation on because that chat holds the tree.
    await page.goto(`/chat/${chat.id}`);
    const chatRow = page
      .locator("li")
      .filter({ has: page.locator(`a[href="/chat/${chat.id}"]`) });
    await chatRow.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "New chat here" }).click();

    await expect(page).toHaveURL(
      new RegExp(
        `/projects/${started.project.id}\\?repository=${started.checkout.repositoryId}.*worktree=1`,
      ),
    );
    // The source chat already binds that checkout, so the start asks for a
    // worktree of it.
    await expect(pillCell(page, "Work in")).toHaveAccessibleName(
      "Work in, a new worktree",
    );

    // "New chat in project" is the project's own entry point: the deep link
    // names only the project, so the pill follows its primary link.
    await page.goto("/projects");
    const projectRow = page
      .locator("li")
      .filter({ hasText: started.project.name });
    // The row's actions live in a hover-revealed track: while it is collapsed
    // the button is clipped, so a pointer click has to reveal it first, exactly
    // as the reader does.
    await projectRow.hover();
    await projectRow.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "New chat in project" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/projects/${started.project.id}$`),
    );
    await expect(pillCell(page, "Folder")).toHaveAccessibleName(
      `Folder, ${folderOf(started.checkout.path)}`,
    );
  });
});
