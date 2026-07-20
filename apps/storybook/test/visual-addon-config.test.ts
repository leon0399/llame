import { statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import config from "../.storybook/main.js";

describe("local visual addon configuration", () => {
  it("resolves UI story roots from the Storybook working directory", () => {
    const addon = config.addons?.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "name" in entry &&
        entry.name === "@workspace/storybook-addon-visual-tests/preset",
    );

    expect(addon).toMatchObject({
      options: { storyRoots: ["../../packages/ui/src"] },
    });

    const storyRoot = path.resolve(
      import.meta.dirname,
      "..",
      "../../packages/ui/src",
    );
    expect(statSync(storyRoot).isDirectory()).toBe(true);
  });
});
