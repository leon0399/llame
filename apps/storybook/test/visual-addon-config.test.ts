import { statSync } from "node:fs";
import path from "node:path";

import { loadMainConfig } from "storybook/internal/common";
import { describe, expect, it } from "vitest";

describe("storyproof addon configuration", () => {
  it("registers the published preset for every story root", async () => {
    const storyRoots = ["../../packages/ui/src", "../../apps/web"];
    const storybookRoot = path.resolve(import.meta.dirname, "..");
    // loadMainConfig only evaluates main.ts and returns its literal config —
    // it does not resolve the addon `name` as a module specifier — so prove
    // the published `storyproof` package's `/preset` export is actually
    // installed and resolvable from apps/storybook by importing it directly.
    const preset = await import("storyproof/preset");
    expect(preset.managerEntries).toBeTypeOf("function");

    const effectiveConfig = await loadMainConfig({
      configDir: path.join(storybookRoot, ".storybook"),
      cwd: storybookRoot,
      skipCache: true,
    });
    expect(effectiveConfig.addons).toContainEqual({
      name: "storyproof/preset",
      options: { storyRoots },
    });

    // Every configured root must be a real directory relative to the
    // Storybook working directory (apps/storybook), or capture fails for its
    // stories.
    for (const root of storyRoots) {
      const resolved = path.resolve(import.meta.dirname, "..", root);
      expect(statSync(resolved).isDirectory()).toBe(true);
    }
  });
});
