import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";

export const mutationWorkspaces = [
  "apps/api",
  "packages/config-interpolation",
  "packages/runtime-safety",
];

function documentation(file) {
  return (
    /^[^/]+\.md$/u.test(file) ||
    /^(docs|openspec|\.agents|\.claude|\.codex|\.opencode)\//u.test(file) ||
    /^(apps|packages)\/[^/]+\/(AGENTS|CLAUDE|GEMINI|README)\.md$/u.test(file)
  );
}

function unrelated(file) {
  return /^(apps\/(web|storybook)|packages\/(ui|oxlint-plugin-anti-slop)|e2e)\//u.test(
    file,
  );
}

function testSupport(file) {
  if (file.endsWith("/eval/dataset.ts")) return true;
  return /(^|\/)(__mocks__|__fixtures__|fixtures|testing)\/|(^|[./-])(test-fixture|test-helper|fixture|fake|mock|stub)([./-]|$)/u.test(
    file,
  );
}

function git(arguments_, cwd) {
  return execFileSync("git", arguments_, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function changedFiles(base, cwd = process.cwd()) {
  const revision = git(
    ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`],
    cwd,
  ).trim();
  const ancestor = git(["merge-base", "HEAD", revision], cwd).trim();
  return [
    ...new Set(
      (
        git(
          ["diff", "--name-only", "--no-renames", "-z", ancestor, "--"],
          cwd,
        ) + git(["ls-files", "--others", "--exclude-standard", "-z"], cwd)
      )
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
}

export function mutationSourceFiles(workspace) {
  const config = JSON.parse(
    readFileSync(path.join(workspace, "stryker.config.json"), "utf8"),
  );
  const files = new Set();
  for (const pattern of config.mutate.filter(
    (value) => !value.startsWith("!"),
  )) {
    for (const file of globSync(pattern, { cwd: workspace })) files.add(file);
  }
  for (const pattern of config.mutate.filter((value) =>
    value.startsWith("!"),
  )) {
    for (const file of globSync(pattern.slice(1), { cwd: workspace }))
      files.delete(file);
  }
  const selected = [...files]
    .map((file) => file.split(path.sep).join("/"))
    .sort();
  if (selected.length === 0)
    throw new Error("Configured mutation scope is empty");
  if (selected.some((file) => /[,!*?{}[\]()\\]/u.test(file))) {
    throw new Error(
      "Mutation filenames cannot contain glob metacharacters or commas",
    );
  }
  return selected;
}

export function selectMutationScope(changes, sources) {
  const scopes = Object.fromEntries(
    mutationWorkspaces.map((workspace) => [
      workspace,
      { mode: "skip", files: [] },
    ]),
  );
  const full = (workspace) => {
    scopes[workspace] = { mode: "full", files: sources[workspace] };
  };

  for (const file of changes) {
    if (documentation(file)) continue;
    const workspace = mutationWorkspaces.find((directory) =>
      file.startsWith(`${directory}/`),
    );
    if (workspace) {
      const relative = file.slice(workspace.length + 1);
      if (testSupport(relative) || !sources[workspace].includes(relative))
        full(workspace);
      else if (scopes[workspace].mode !== "full") {
        scopes[workspace].mode = "changed";
        scopes[workspace].files.push(relative);
      }
      // API consumes built shared packages; their changes are outside its
      // own mutant/test files and cannot be inferred by Stryker incremental mode.
      if (workspace.startsWith("packages/")) full("apps/api");
    } else if (/^packages\/(native-file-tools|bash-executor)\//u.test(file)) {
      full("apps/api");
    } else if (!unrelated(file)) {
      for (const directory of mutationWorkspaces) full(directory);
    }
  }
  for (const scope of Object.values(scopes))
    scope.files = [...new Set(scope.files)].sort();
  return scopes;
}

function workspaceDependencies(workspace, root, dependencies = new Set()) {
  const manifest = JSON.parse(
    readFileSync(path.join(root, workspace, "package.json"), "utf8"),
  );
  for (const name of Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  })) {
    if (!name.startsWith("@workspace/")) continue;
    const directory = `packages/${name.slice("@workspace/".length)}`;
    if (dependencies.has(directory)) continue;
    dependencies.add(directory);
    workspaceDependencies(directory, root, dependencies);
  }
  return dependencies;
}

export function mutationFingerprint(workspace, root = process.cwd()) {
  const mutated = new Set(mutationSourceFiles(path.join(root, workspace)));
  const dependencies = [...workspaceDependencies(workspace, root)];
  const inputs = git(
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    root,
  )
    .split("\0")
    .filter(Boolean)
    .filter((file) => {
      if (documentation(file)) return false;
      if (file.startsWith(`${workspace}/`)) {
        const relative = file.slice(workspace.length + 1);
        return (
          testSupport(relative) ||
          (!mutated.has(relative) && !relative.endsWith(".test.ts"))
        );
      }
      if (/^(apps|packages)\//u.test(file))
        return dependencies.some((directory) =>
          file.startsWith(`${directory}/`),
        );
      // Unknown repository-level inputs invalidate conservatively. Stryker
      // does not track configuration, fixtures or imported workspace packages.
      return !unrelated(file);
    })
    .sort();
  const hash = createHash("sha256");
  for (const file of inputs) {
    const absolute = path.join(root, file);
    hash
      .update(file)
      .update("\0")
      .update(
        existsSync(absolute)
          ? createHash("sha256").update(readFileSync(absolute)).digest("hex")
          : "",
      )
      .update("\0");
  }
  return hash.digest("hex");
}

export function readMutationScope(base) {
  const root = git(["rev-parse", "--show-toplevel"], process.cwd()).trim();
  const sources = Object.fromEntries(
    mutationWorkspaces.map((workspace) => [
      workspace,
      mutationSourceFiles(path.join(root, workspace)),
    ]),
  );
  return base === undefined
    ? Object.fromEntries(
        mutationWorkspaces.map((workspace) => [
          workspace,
          { mode: "full", files: sources[workspace] },
        ]),
      )
    : selectMutationScope(changedFiles(base, root), sources);
}
