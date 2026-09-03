import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  request as playwrightRequest,
  test as baseTest,
} from "@playwright/test";
import playwrightConfig from "../../playwright.config";
import {
  expectProtectedShell,
  loginViaUi,
  registerAccount,
  type TestAccount,
} from "./auth-helpers";

export * from "@playwright/test";
export * from "./auth-helpers";

type Fixtures = {
  account: TestAccount;
  freshAccount: TestAccount;
};

export type KnowledgeSpaceFixture = {
  id: string;
  directory: string;
};

type WorkerFixtures = {
  workerAccount: TestAccount;
  workerStorageState: string;
  knowledgeRoot: string;
  workerKnowledgeSpace: KnowledgeSpaceFixture;
};

const knowledgeApiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;

export function hasStableId(value: unknown): value is { id: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string"
  );
}

export function revokeKnowledgeSpaceFixtureAccess(
  ownerUserId: string,
  knowledgeSpaceId: string,
): void {
  const container = process.env.E2E_DB_CONTAINER ?? "llame-e2e-postgres";
  const dbPort = process.env.E2E_DB_PORT ?? "55433";
  const databaseUrl =
    process.env.POSTGRES_URL ??
    `postgres://app:app@localhost:${dbPort}/llame_e2e`;
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
  const escape = (value: string) => value.replaceAll("'", "''");
  const statement = `BEGIN; SELECT set_config('app.current_user_id', '${escape(ownerUserId)}', true); DELETE FROM knowledge_spaces WHERE knowledge_space_id = '${escape(knowledgeSpaceId)}'; COMMIT;`;

  if (process.env.POSTGRES_URL) {
    execFileSync(
      "psql",
      [databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", statement],
      { stdio: "inherit" },
    );
    return;
  }

  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "app",
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      statement,
    ],
    { stdio: "inherit" },
  );
}

export const test = baseTest.extend<Fixtures, WorkerFixtures>({
  // An uncaught client exception fails the test that caused it. Without this
  // the page keeps rendering and only the assertions notice — #260 (a double
  // resumeStream race throwing on every mid-run reload) logged silently in CI
  // for weeks because nothing asserted on page errors.
  page: async ({ page }, provide) => {
    const pageErrors: Array<Error> = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await provide(page);

    if (pageErrors.length > 0) {
      throw new Error(
        `Uncaught client exception(s) during this test:\n${pageErrors
          .map((error) => `  - ${error.message}`)
          .join("\n")}`,
      );
    }
  },

  account: async ({ workerAccount }, provide) => {
    await provide(workerAccount);
  },

  // oxlint-disable-next-line eslint/no-empty-pattern -- Playwright statically requires fixture callbacks to destructure their first parameter.
  freshAccount: async ({}, provide) => {
    const request = await playwrightRequest.newContext();

    try {
      await provide(
        await registerAccount(
          request,
          `fresh-${test.info().retry}`,
          test.info().parallelIndex,
        ),
      );
    } finally {
      await request.dispose();
    }
  },

  storageState: ({ workerStorageState }, provide) =>
    provide(workerStorageState),

  workerAccount: [
    // oxlint-disable-next-line eslint/no-empty-pattern -- Playwright statically requires fixture callbacks to destructure their first parameter.
    async ({}, provide) => {
      const request = await playwrightRequest.newContext();

      try {
        await provide(
          await registerAccount(
            request,
            `worker-${test.info().parallelIndex}`,
            test.info().parallelIndex,
          ),
        );
      } finally {
        await request.dispose();
      }
    },
    { scope: "worker" },
  ],

  knowledgeRoot: [
    // oxlint-disable-next-line eslint/no-empty-pattern -- Playwright statically requires fixture callbacks to destructure their first parameter.
    async ({}, provide) => {
      const root = process.env.E2E_KNOWLEDGE_ROOT;
      if (!root) {
        throw new Error("E2E_KNOWLEDGE_ROOT is required for Knowledge tests");
      }
      fs.mkdirSync(root, { recursive: true });
      await provide(root);
    },
    { scope: "worker" },
  ],

  workerKnowledgeSpace: [
    async ({ workerAccount, knowledgeRoot }, provide) => {
      const request = await playwrightRequest.newContext();

      try {
        const response = await request.post(
          `${knowledgeApiUrl}/api/v1/knowledge-spaces`,
          {
            headers: { Authorization: `Bearer ${workerAccount.token}` },
            data: { name: "Personal" },
          },
        );
        if (!response.ok()) {
          throw new Error(
            `Failed to provision the worker Knowledge Space: ${response.status()} ${await response.text()}`,
          );
        }
        const body: unknown = await response.json();
        if (!hasStableId(body)) {
          throw new Error(
            "Worker Knowledge provisioning returned no stable ID",
          );
        }

        await provide({
          id: body.id,
          directory: path.join(knowledgeRoot, body.id),
        });
      } finally {
        await request.dispose();
      }
    },
    { scope: "worker" },
  ],

  workerStorageState: [
    async ({ browser, workerAccount }, provide) => {
      // Keyed by the ACCOUNT, not the worker slot. `parallelIndex` names a
      // slot and is reused when a worker restarts — and a retry always
      // restarts one — while `workerAccount` registers a fresh user per
      // worker process. Keying by slot therefore handed a retry's new account
      // the previous account's cached cookies: the browser acted as user A
      // while the spec's Bearer requests authenticated as user B, so
      // owner-scoped reads 404'd on a chat the page had just created.
      const fileName = path.resolve(
        test.info().project.outputDir,
        `.auth/${workerAccount.id}.json`,
      );

      if (!fs.existsSync(fileName)) {
        fs.mkdirSync(path.dirname(fileName), { recursive: true });

        const page = await browser.newPage({
          baseURL: playwrightConfig.use?.baseURL,
          locale: playwrightConfig.use?.locale,
          storageState: undefined,
        });

        try {
          await page.goto("/login");
          await loginViaUi(page, workerAccount);
          await expectProtectedShell(page, workerAccount);
          await page.context().storageState({ path: fileName });
        } finally {
          await page.close();
        }
      }

      await provide(fileName);
    },
    { scope: "worker" },
  ],
});
