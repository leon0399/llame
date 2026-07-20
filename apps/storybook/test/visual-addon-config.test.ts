import { statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import config from "../.storybook/main.js";

describe("local visual addon configuration", () => {
  it("resolves every configured story root from the Storybook working directory", () => {
    const addon = config.addons?.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "name" in entry &&
        entry.name === "@workspace/storybook-addon-visual-tests/preset",
    );

    const storyRoots = ["../../packages/ui/src", "../../apps/web"];
    expect(addon).toMatchObject({ options: { storyRoots } });

    // Every configured root must be a real directory relative to the Storybook
    // working directory (apps/storybook), or capture fails for its stories.
    for (const root of storyRoots) {
      const resolved = path.resolve(import.meta.dirname, "..", root);
      expect(statSync(resolved).isDirectory()).toBe(true);
    }
  });
});
