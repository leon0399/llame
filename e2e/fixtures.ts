import fs from "node:fs";
import path from "node:path";
import {
  request as playwrightRequest,
  test as baseTest,
} from "@playwright/test";
import playwrightConfig from "../playwright.config";
import {
  expectProtectedShell,
  loginViaUi,
  registerAccount,
  type TestAccount,
} from "./auth/helpers";

export * from "@playwright/test";
export * from "./auth/helpers";

type Fixtures = {
  account: TestAccount;
  freshAccount: TestAccount;
};

type WorkerFixtures = {
  workerAccount: TestAccount;
  workerStorageState: string;
};

export const test = baseTest.extend<Fixtures, WorkerFixtures>({
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

  workerStorageState: [
    async ({ browser, workerAccount }, use) => {
      const fileName = path.resolve(
        test.info().project.outputDir,
        `.auth/${test.info().parallelIndex}.json`,
      );

      if (!fs.existsSync(fileName)) {
        fs.mkdirSync(path.dirname(fileName), { recursive: true });

        const page = await browser.newPage({
          baseURL:
            typeof playwrightConfig.use?.baseURL === "string"
              ? playwrightConfig.use.baseURL
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
