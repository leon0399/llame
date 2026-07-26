import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("local visual addon configuration", () => {
  it("resolves the source preset and every story root", async () => {
    const sourcePreset = new URL(
      "../../../packages/storybook-addon-visual-tests/src/preset.ts",
      import.meta.url,
    ).href;
    const configSource = await readFile(
      new URL("../.storybook/main.ts", import.meta.url),
      "utf8",
    );
    expect(configSource).toMatch(
      /const\s+visualTestsPreset\s*=\s*import\.meta\.resolve\(\s*["']\.\.\/\.\.\/\.\.\/packages\/storybook-addon-visual-tests\/src\/preset\.ts["']\s*,?\s*\)/,
    );
    expect(configSource).toMatch(/name:\s*visualTestsPreset/);

    const storyRoots = ["../../packages/ui/src", "../../apps/web"];
    expect(configSource).toMatch(
      /storyRoots:\s*\[\s*["']\.\.\/\.\.\/packages\/ui\/src["']\s*,\s*["']\.\.\/\.\.\/apps\/web["']\s*,?\s*\]/,
    );
    expect(statSync(new URL(sourcePreset)).isFile()).toBe(true);

    // Every configured root must be a real directory relative to the Storybook
    // working directory (apps/storybook), or capture fails for its stories.
    for (const root of storyRoots) {
      const resolved = path.resolve(import.meta.dirname, "..", root);
      expect(statSync(resolved).isDirectory()).toBe(true);
    }
  });
});
