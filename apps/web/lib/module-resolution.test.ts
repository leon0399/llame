import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("web module resolution", () => {
  it("starts Next dev from the monorepo root", () => {
    const packageJson = JSON.parse(
      readFileSync(join(repoRoot, "apps/web/package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.dev).toBe("cd ../.. && next dev apps/web");
  });
});
