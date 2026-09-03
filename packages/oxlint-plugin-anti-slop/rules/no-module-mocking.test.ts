import { RuleTester } from "oxlint/plugins-dev";

import { noModuleMockingRule } from "./no-module-mocking.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const error = { messageId: "moduleMock" };

tester.run("anti-slop/no-module-mocking", noModuleMockingRule, {
  valid: [
    // External npm packages are a real boundary, not our code hidden behind a
    // fixture. There is often no in-process seam behind them at all.
    'import { vi } from "vitest"; vi.mock("next/navigation", () => ({}));',
    'import { vi } from "vitest"; vi.mock("@ai-sdk/react", () => ({}));',
    'import { vi } from "vitest"; vi.mock("framer-motion", () => ({}));',
    'import { vi } from "vitest"; vi.mock("node:fs", () => ({}));',
    // Not a module mock at all.
    'import { vi } from "vitest"; vi.fn();',
    'import { vi } from "vitest"; vi.stubGlobal("fetch", vi.fn());',
  ],
  invalid: [
    {
      code: 'import { vi } from "vitest"; vi.mock("./sibling", () => ({}));',
      errors: [error],
    },
    {
      code: 'import { vi } from "vitest"; vi.mock("../../api/fetch", () => ({}));',
      errors: [error],
    },
    {
      code: 'import { vi } from "vitest"; vi.mock("@/lib/services/chat/queries", () => ({}));',
      errors: [error],
    },
    {
      code: 'import { vi } from "vitest"; vi.mock("@workspace/ui/hooks/use-mobile", () => ({}));',
      errors: [error],
    },
    // A computed specifier cannot be checked; fail closed.
    {
      code: 'import { vi } from "vitest"; declare const p: string; vi.mock(p, () => ({}));',
      errors: [error],
    },
    {
      code: 'import { vi } from "vitest"; vi.doMock("./sibling", () => ({}));',
      errors: [error],
    },
  ],
});
