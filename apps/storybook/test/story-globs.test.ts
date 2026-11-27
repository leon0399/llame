import { statSync } from "node:fs";
import path from "node:path";

import { loadMainConfig } from "storybook/internal/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const storybookRoot = path.resolve(import.meta.dirname, "..");
const configDir = path.join(storybookRoot, ".storybook");

describe("Storybook story globs", () => {
  // A glob under a moved or renamed directory matches nothing, and Storybook
  // then silently drops every story under it instead of failing.
  it("points every story glob at an existing directory", async () => {
    const config = await loadMainConfig({
      configDir,
      cwd: storybookRoot,
      skipCache: true,
    });

    // main.ts names its stories as plain glob strings.
    const globs = z.array(z.string()).min(1).parse(config.stories);

    for (const glob of globs) {
      const base = glob.split("/**")[0] ?? glob;

      expect(statSync(path.resolve(configDir, base)).isDirectory()).toBe(true);
    }
  });
});
