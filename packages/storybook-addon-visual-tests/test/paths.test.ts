import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { resolveArtifactPaths } from "../src/node/paths.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        import("node:fs/promises").then(({ rm }) =>
          rm(directory, { recursive: true, force: true }),
        ),
      ),
  );
});

async function fixture() {
  const cwd = await mkdtemp(path.join(tmpdir(), "visual-paths-"));
  temporaryDirectories.push(cwd);
  const root = path.join(cwd, "src");
  await mkdir(root);
  await writeFile(path.join(root, "button.stories.tsx"), "export default {};");
  return { cwd, root };
}

describe("resolveArtifactPaths", () => {
  test("maps a story source to stable source-adjacent artifacts", async () => {
    const { cwd, root } = await fixture();

    const artifacts = await resolveArtifactPaths({
      cwd,
      storyRoots: [root],
      importPath: ".\\src\\button.stories.tsx",
      storyId: "button--primary",
      environmentKey: "chromium-1280x720@1x",
    });

    const directory = path.join(
      root,
      "__screenshots__",
      "button.stories.tsx.visual",
      "button--primary",
      "chromium-1280x720@1x",
    );
    expect(artifacts).toMatchObject({
      directory,
      baselinePath: path.join(directory, "baseline.png"),
      baselineMetadataPath: path.join(directory, "baseline.json"),
      candidatePath: path.join(directory, "candidate.png"),
      diffPath: path.join(directory, "diff.png"),
      resultPath: path.join(directory, "result.json"),
    });
    expect(
      path.basename(path.dirname(path.dirname(artifacts.directory))),
    ).not.toMatch(/\.stories\.[cm]?[jt]sx?$/);
  });

  test("uses source identity rather than display titles", async () => {
    const { cwd, root } = await fixture();
    await mkdir(path.join(root, "nested"));
    await writeFile(
      path.join(root, "nested", "button.stories.tsx"),
      "export default {};",
    );

    const first = await resolveArtifactPaths({
      cwd,
      storyRoots: [root],
      importPath: "./src/button.stories.tsx",
      storyId: "duplicate--story",
      environmentKey: "chromium",
    });
    const second = await resolveArtifactPaths({
      cwd,
      storyRoots: [root],
      importPath: "./src/nested/button.stories.tsx",
      storyId: "duplicate--story",
      environmentKey: "chromium",
    });

    expect(first.directory).not.toBe(second.directory);
  });

  test.each([
    ["absolute import", "/tmp/story.stories.tsx", "story", "chromium"],
    ["traversing import", "../story.stories.tsx", "story", "chromium"],
    ["story separator", "./src/button.stories.tsx", "a/b", "chromium"],
    ["story dot segment", "./src/button.stories.tsx", "..", "chromium"],
    ["absolute story", "./src/button.stories.tsx", "/story", "chromium"],
    ["environment separator", "./src/button.stories.tsx", "story", "a/b"],
    ["environment dot segment", "./src/button.stories.tsx", "story", "."],
    ["absolute environment", "./src/button.stories.tsx", "story", "/env"],
  ])("rejects %s", async (_name, importPath, storyId, environmentKey) => {
    const { cwd, root } = await fixture();

    await expect(
      resolveArtifactPaths({
        cwd,
        storyRoots: [root],
        importPath,
        storyId,
        environmentKey,
      }),
    ).rejects.toThrow();
  });

  test("does not confuse sibling-prefix roots", async () => {
    const { cwd, root } = await fixture();
    const sibling = `${root}-other`;
    await mkdir(sibling);
    await writeFile(
      path.join(sibling, "outside.stories.tsx"),
      "export default {};",
    );

    await expect(
      resolveArtifactPaths({
        cwd,
        storyRoots: [root],
        importPath: `./${path.basename(sibling)}/outside.stories.tsx`,
        storyId: "outside--story",
        environmentKey: "chromium",
      }),
    ).rejects.toThrow(/story root/i);
  });

  test("rejects a symlinked story that escapes its configured root", async () => {
    const { cwd, root } = await fixture();
    const outside = path.join(cwd, "outside.stories.tsx");
    await writeFile(outside, "export default {};");
    await symlink(outside, path.join(root, "linked.stories.tsx"));

    await expect(
      resolveArtifactPaths({
        cwd,
        storyRoots: [root],
        importPath: "./src/linked.stories.tsx",
        storyId: "linked--story",
        environmentKey: "chromium",
      }),
    ).rejects.toThrow(/story root/i);
  });

  test("rejects an existing artifact ancestor symlink that escapes the root", async () => {
    const { cwd, root } = await fixture();
    const outside = path.join(cwd, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(root, "__screenshots__"));

    await expect(
      resolveArtifactPaths({
        cwd,
        storyRoots: [root],
        importPath: "./src/button.stories.tsx",
        storyId: "button--primary",
        environmentKey: "chromium",
      }),
    ).rejects.toThrow(/artifact root/i);

    expect(await realpath(path.join(root, "__screenshots__"))).toBe(outside);
  });
});
