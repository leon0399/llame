import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("shared Storybook styles", () => {
  it("loads tw-animate-css before Tailwind source directives", async () => {
    const css = await readFile(
      fileURLToPath(
        new URL("../../../packages/ui/src/styles/globals.css", import.meta.url),
      ),
      "utf8",
    );

    expect(css.indexOf('@import "tw-animate-css"')).toBeLessThan(
      css.indexOf("@source"),
    );
  });
});
