import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const packageRoot = new URL("../", import.meta.url);

async function readJson(
  relativePath: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(new URL(relativePath, packageRoot), "utf8"),
  ) as Record<string, unknown>;
}

describe("compiled package contract", () => {
  test("builds all public entry points to explicit JavaScript and declaration targets", async () => {
    const packageJson = await readJson("package.json");
    const scripts = packageJson.scripts as Record<string, string>;
    const exports = packageJson.exports as Record<
      string,
      { import?: string; types?: string }
    >;

    expect(scripts.build).toBeTypeOf("string");
    expect(scripts.test).toContain("pnpm test:build");
    expect(Object.keys(exports).sort()).toEqual(
      [".", "./manager", "./preset", "./preview"].sort(),
    );
    expect(exports).toMatchObject({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
      "./manager": {
        types: "./dist/manager.d.ts",
        import: "./dist/manager.js",
      },
      "./preset": {
        types: "./dist/preset.d.ts",
        import: "./dist/preset.js",
      },
      "./preview": {
        types: "./dist/preview.d.ts",
        import: "./dist/preview.js",
      },
    });
  });

  test("configures NodeNext React emission and caches dist", async () => {
    const buildConfig = await readJson("tsconfig.build.json");
    const compilerOptions = buildConfig.compilerOptions as Record<
      string,
      unknown
    >;
    const turbo = await readJson("turbo.json");
    const tasks = turbo.tasks as Record<string, { outputs?: string[] }>;

    expect(compilerOptions).toMatchObject({
      rootDir: "src",
      outDir: "dist",
      declaration: true,
      declarationMap: true,
      sourceMap: true,
    });
    expect(buildConfig.extends).toBe("./tsconfig.json");
    expect(buildConfig.include).toEqual(["src/**/*.ts", "src/**/*.tsx"]);
    expect(buildConfig.exclude).toEqual([
      "src/**/*.stories.ts",
      "src/**/*.stories.tsx",
    ]);
    expect(tasks.build?.outputs).toEqual(["dist/**"]);
  });
});
