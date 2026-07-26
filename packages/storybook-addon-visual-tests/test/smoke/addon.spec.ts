import path from "node:path";

import { expect, test } from "@playwright/test";

import { registerAddonAcceptanceSuite } from "../acceptance/addon-suite.js";

registerAddonAcceptanceSuite({
  expect,
  projectRoot: path.join(process.cwd(), "test/.tmp/project"),
  staticBaseURL: `http://127.0.0.1:${process.env.VISUAL_TEST_STATIC_PORT ?? "6011"}`,
  test,
});
