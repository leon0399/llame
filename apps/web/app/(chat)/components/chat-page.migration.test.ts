import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

const readRepoFile = (path: string) =>
  readFileSync(join(repoRoot, path), "utf8");

describe("chat page AI Elements migration", () => {
  it("uses shared AI Elements components instead of the old app-local chat primitives", () => {
    const source = readRepoFile("apps/web/app/(chat)/components/chat-page.tsx");

    expect(source).toContain("@workspace/ui/components/ai-elements/");
    expect(source).not.toContain("@/components/components/ai/");
  });

  it("does not keep chat-rendering implementation dependencies owned by apps/web", () => {
    const packageJson = JSON.parse(readRepoFile("apps/web/package.json")) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies).not.toHaveProperty("framer-motion");
    expect(packageJson.dependencies).not.toHaveProperty("use-stick-to-bottom");
    expect(packageJson.dependencies).not.toHaveProperty("shiki");
  });
});
