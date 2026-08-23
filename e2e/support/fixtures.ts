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

export const test = baseTest.extend<Fixtures, WorkerFixtures>({
  // An uncaught client exception fails the test that caused it. Without this
  // the page keeps rendering and only the assertions notice — #260 (a double
  // resumeStream race throwing on every mid-run reload) logged silently in CI
  // for weeks because nothing asserted on page errors.
  page: async ({ page }, use) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await use(page);

    if (pageErrors.length > 0) {
      throw new Error(
        `Uncaught client exception(s) during this test:\n${pageErrors
          .map((error) => `  - ${error.message}`)
          .join("\n")}`,
      );
    }
  },

  account: async ({ workerAccount }, use) => {
    await use(workerAccount);
  },

  freshAccount: async ({}, use) => {
    const request = await playwrightRequest.newContext();

    try {
      await use(
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

  storageState: ({ workerStorageState }, use) => use(workerStorageState),

  workerAccount: [
    async ({}, use) => {
      const request = await playwrightRequest.newContext();

      try {
        await use(
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
    async ({}, use) => {
      const root = process.env.E2E_KNOWLEDGE_ROOT;
      if (!root) {
        throw new Error("E2E_KNOWLEDGE_ROOT is required for Knowledge tests");
      }
      fs.mkdirSync(root, { recursive: true });
      await use(root);
    },
    { scope: "worker" },
  ],

  workerKnowledgeSpace: [
    async ({ workerAccount, knowledgeRoot }, use) => {
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
        const body = (await response.json()) as { id?: unknown };
        if (typeof body.id !== "string") {
          throw new Error(
            "Worker Knowledge provisioning returned no stable ID",
          );
        }

        await use({
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
    async ({ browser, workerAccount }, use) => {
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
          baseURL:
            typeof playwrightConfig.use?.baseURL === "string"
              ? playwrightConfig.use.baseURL
              : undefined,
          locale:
            typeof playwrightConfig.use?.locale === "string"
              ? playwrightConfig.use.locale
              : undefined,
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

      await use(fileName);
    },
    { scope: "worker" },
  ],
});
