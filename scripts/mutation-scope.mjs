import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

export const mutationWorkspaces = [
  "apps/api",
  "packages/config-interpolation",
  "packages/runtime-safety",
];

// The API corpus runs in a fixed runner pool. Shard identity indexes both the
// plan matrix and the per-shard baseline caches, so the count is shared here.
export const apiShardCount = 8;

const undetectedStatuses = new Set(["Survived", "NoCoverage"]);

function testFile(file) {
  return /\.test\.[cm]?ts$/u.test(file);
}

// Every workspace's gate reads the same merged index. The API writes it from
// its shard reports; a package writes it from its own single report.
export const mutationBaselineFile = "reports/mutation-baseline.json";

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

function mutationTooling(file) {
  return (
    file.startsWith(".github/") ||
    /(^|\/)\.gitignore$/u.test(file) ||
    /^scripts\/mutation-(scope|sharding)(\.test)?\.mjs$/u.test(file) ||
    mutationWorkspaces.some(
      (workspace) => file === `${workspace}/stryker.config.json`,
    )
  );
}

/**
 * Lint and format configuration. These read source text and never run during a
 * test, so no mutant's status can depend on them — the same reasoning that
 * exempts CI wiring and `.gitignore`. Mutation tooling is deliberately NOT
 * here: an engine or Stryker configuration change can move every measurement,
 * so it must still invalidate the index.
 */
function qualityTooling(file) {
  return (
    /(^|\/)\.markdownlint-cli2\.jsonc$/u.test(file) ||
    /(^|\/)\.oxlintrc\.json$/u.test(file) ||
    /(^|\/)\.prettierignore$/u.test(file) ||
    /(^|\/)\.prettierrc(\.[a-z]+)?$/u.test(file)
  );
}

/** The filename without its extension, which is how a reference names it. */
function referenceStem(file) {
  const base = file.split("/").pop() ?? file;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

const workspaceTextCache = new Map();

function workspaceText(workspace, relative, root) {
  const key = `${workspace}/${relative}`;
  if (!workspaceTextCache.has(key)) {
    const absolute = path.join(root, workspace, relative);
    workspaceTextCache.set(
      key,
      existsSync(absolute) ? readFileSync(absolute, "utf8") : "",
    );
  }
  return workspaceTextCache.get(key);
}

/**
 * A reference, not a coincidence: the stem has to sit inside something
 * path-shaped, so a file that merely uses the word is not counted.
 */
function referencePattern(stem) {
  const escaped = stem.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`[/'"\`(]${escaped}[.'"\`/)]`, "u");
}

/**
 * The mutation-run tests that read `target`, following references transitively.
 *
 * A changed file that is not a mutant source can only move a mutant through a
 * test that reads it, possibly via other modules, so the answer is the test set
 * at the end of that chain. The match over-approximates — any path-shaped
 * mention of the name counts, whatever the file does with it — and
 * over-approximating is the safe direction, because the scope only grows.
 */
function readersOf(workspace, target, root) {
  const files = globSync("src/**/*.ts", {
    cwd: path.join(root, workspace),
  })
    .map((file) => file.split(path.sep).join("/"))
    .sort();
  const reached = new Set();
  let frontier = [target];
  while (frontier.length > 0) {
    const next = [];
    for (const file of frontier) {
      const pattern = referencePattern(referenceStem(file));
      for (const candidate of files) {
        if (candidate === target || reached.has(candidate)) continue;
        if (!pattern.test(workspaceText(workspace, candidate, root))) continue;
        reached.add(candidate);
        next.push(candidate);
      }
    }
    frontier = next;
  }
  return [...reached].filter(testFile).sort();
}

function git(arguments_, cwd) {
  return execFileSync("git", arguments_, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function resolveCommit(ref, cwd) {
  return git(
    ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
    cwd,
  ).trim();
}

export function isAncestor(ancestor, descendant, root) {
  try {
    return git(["merge-base", ancestor, descendant], root).trim() === ancestor;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

export function hasCommit(ref, root = process.cwd()) {
  try {
    resolveCommit(ref, root);
    return true;
  } catch {
    return false;
  }
}

export function changedFiles(base, cwd = process.cwd()) {
  const revision = resolveCommit(base, cwd);
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

function mutationCommandsOnly(file, base, root) {
  if (!/(^|\/)package\.json$/u.test(file)) return false;
  let manifests;
  try {
    const ancestor = git(["merge-base", "HEAD", base], root).trim();
    manifests = [
      JSON.parse(git(["show", `${ancestor}:${file}`], root)),
      JSON.parse(readFileSync(path.join(root, file), "utf8")),
    ];
  } catch {
    return false;
  }
  for (const manifest of manifests)
    manifest.scripts = Object.fromEntries(
      Object.entries(manifest.scripts ?? {}).filter(
        ([name]) => !/^test:mutation($|:)/u.test(name),
      ),
    );
  return isDeepStrictEqual(...manifests);
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

// Normalizes Stryker reports into the one shape the scope and delta gates
// read: per source file, how much work it carries, how much of it is
// undetected, and which test files can flip it.
//
// `coveredBy` holds test ids that only resolve against the `testFiles` of the
// same report, so each report is mapped on its own. Ids that are already test
// paths (an index read back in) pass through unchanged.
const mutationBaselineVersion = 2;

function mutationBaselineFiles(reports) {
  const files = {};
  for (const report of reports) {
    if (!report || typeof report.files !== "object" || report.files === null)
      throw new Error("Invalid mutation baseline report");
    const testPaths = new Map(
      Object.entries(report.testFiles ?? {}).flatMap(([file, entry]) =>
        (entry?.tests ?? []).map((test) => [test.id, file]),
      ),
    );
    for (const [file, entry] of Object.entries(report.files)) {
      if (!Array.isArray(entry?.mutants))
        throw new Error(`Invalid mutant list for ${file}`);
      const coveredBy = new Set();
      let undetected = 0;
      let tested = 0;
      for (const mutant of entry.mutants) {
        if (mutant.status === "Ignored") continue;
        tested += 1;
        if (undetectedStatuses.has(mutant.status)) undetected += 1;
        for (const id of mutant.coveredBy ?? [])
          coveredBy.add(testPaths.get(id) ?? id);
      }
      files[file] = {
        mutants: tested,
        undetected,
        coveredBy: [...coveredBy].sort(),
      };
    }
  }
  return files;
}

export function mutationBaseline(reports) {
  return {
    baselineVersion: mutationBaselineVersion,
    files: mutationBaselineFiles(reports),
  };
}

export function mergeMutationBaseline(previous, reports) {
  const measured = mutationBaselineFiles(reports);
  const files = { ...(previous?.files ?? {}) };
  for (const [file, entry] of Object.entries(measured)) {
    // Retain known coverage so a narrower measurement cannot narrow future
    // scopes. Scope selection filters entries against the current sources.
    const coveredBy = new Set([
      ...(files[file]?.coveredBy ?? []),
      ...entry.coveredBy,
    ]);
    files[file] = { ...entry, coveredBy: [...coveredBy].sort() };
  }
  return { baselineVersion: mutationBaselineVersion, files };
}

// The index is the only accepted baseline: a raw report at this path would
// mean the writer and the reader disagree, which is worth failing on rather
// than measuring a delta against a shape nothing produces.
export function readMutationBaselineFile(file) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (
    parsed?.baselineVersion !== mutationBaselineVersion ||
    !/^[a-f0-9]{40}$/u.test(parsed.revision ?? "") ||
    !parsed.files ||
    typeof parsed.files !== "object" ||
    Array.isArray(parsed.files) ||
    Object.values(parsed.files).some(
      (entry) =>
        !Number.isInteger(entry?.mutants) ||
        entry.mutants < 0 ||
        !Number.isInteger(entry?.undetected) ||
        entry.undetected < 0 ||
        entry.undetected > entry.mutants ||
        !Array.isArray(entry?.coveredBy) ||
        entry.coveredBy.some((test) => typeof test !== "string"),
    )
  ) {
    throw new Error(`Invalid mutation baseline: ${file}`);
  }
  return parsed;
}

function readMutationBaseline(workspace, root = process.cwd()) {
  const file = path.join(root, workspace, mutationBaselineFile);
  if (!existsSync(file)) return undefined;
  const baseline = readMutationBaselineFile(file);
  if (
    !hasCommit(baseline.revision, root) ||
    !isAncestor(baseline.revision, resolveCommit("HEAD", root), root)
  )
    return undefined;
  return baseline;
}

export function readMutationBaselines(root = process.cwd()) {
  return Object.fromEntries(
    mutationWorkspaces.map((workspace) => [
      workspace,
      readMutationBaseline(workspace, root),
    ]),
  );
}

function sourcesByTest(baseline) {
  const byTest = new Map();
  for (const [source, entry] of Object.entries(baseline.files)) {
    for (const test of entry.coveredBy) {
      if (!byTest.has(test)) byTest.set(test, new Set());
      byTest.get(test).add(source);
    }
  }
  return byTest;
}

export function selectMutationScope(
  changes,
  sources,
  baselines = {},
  root = process.cwd(),
) {
  const scopes = Object.fromEntries(
    mutationWorkspaces.map((workspace) => [
      workspace,
      { mode: "skip", files: [] },
    ]),
  );
  const unavailable = (workspace, reason) => {
    // Keep every reason: a waiver records what it left unmeasured, and a
    // workspace with several unbounded paths must not report only the last.
    const previous = scopes[workspace];
    scopes[workspace] = {
      mode: "unavailable",
      files: [],
      reason:
        previous.mode === "unavailable"
          ? `${previous.reason}; ${reason}`
          : reason,
    };
  };
  const scoped = (workspace, file) => {
    if (scopes[workspace].mode === "unavailable") return;
    scopes[workspace].mode = "scoped";
    scopes[workspace].files.push(file);
  };
  // Unknown reachability cannot produce a sound delta. Report it without
  // scheduling an implicit full-corpus mutation run.
  const covered = Object.fromEntries(
    mutationWorkspaces.map((workspace) => [
      workspace,
      baselines[workspace] ? sourcesByTest(baselines[workspace]) : undefined,
    ]),
  );
  // Whether the index bounds anything is a question about measured mutants, not
  // about credited tests: an index whose every mutant is uncovered credits no
  // test at all, and a narrower fold retains prior `coveredBy` entries that the
  // latest measurement did not reproduce.
  const measured = Object.fromEntries(
    mutationWorkspaces.map((workspace) => [
      workspace,
      baselines[workspace] !== undefined &&
        Object.values(baselines[workspace].files).some(
          (entry) => entry.mutants > 0,
        ),
    ]),
  );

  for (const file of changes) {
    if (documentation(file) || mutationTooling(file) || qualityTooling(file))
      continue;
    const workspace = mutationWorkspaces.find((directory) =>
      file.startsWith(`${directory}/`),
    );
    if (workspace) {
      const relative = file.slice(workspace.length + 1);
      const byTest = covered[workspace];
      if (testFile(relative)) {
        // The baseline attributes no coverage to this test, so editing it
        // cannot change the status of any mutant the baseline measured: the
        // gate is a delta on GAINED undetected mutants, and a test the index
        // does not credit can only add kills. That covers a test the pull
        // request adds, and a test the mutation run never executes — an
        // integration test excluded by the runner's own config — which can
        // never be indexed at any revision.
        //
        // Absent evidence is different from absent coverage. Neither an absent
        // index nor one that measured nothing can bound this change, and each
        // names its own failure so an operator can tell a stale index from one
        // that measured nothing.
        if (byTest === undefined)
          unavailable(
            workspace,
            `No compatible ancestor mutation baseline: ${relative}`,
          );
        else if (!measured[workspace])
          unavailable(
            workspace,
            `Mutation baseline measured no mutants: ${relative}`,
          );
        else
          for (const source of byTest.get(relative) ?? [])
            if (sources[workspace].includes(source)) scoped(workspace, source);
      } else if (sources[workspace].includes(relative)) {
        scoped(workspace, relative);
      } else {
        // A changed file inside the workspace that is not a mutant source: a
        // test double, a fixture, a migration, a generated artifact, prompt
        // markdown. It can only move a mutant through a test that reads it, so
        // bound the change by those readers instead of refusing to measure it.
        const tests = readersOf(workspace, relative, root);
        if (tests.length > 0) {
          // Absent evidence is still absent evidence: with no usable index the
          // readers cannot be bounded, so this stays unavailable rather than
          // skipping a change nothing measured.
          if (byTest === undefined || !measured[workspace]) {
            unavailable(
              workspace,
              `No compatible ancestor mutation baseline: ${relative}`,
            );
          } else {
            for (const reader of tests) {
              // A reader the baseline credits nothing covers no mutant it
              // measured — an integration test the mutation run never executes,
              // or a test this pull request adds — so it can only add kills and
              // contributes nothing. The same rule a changed test file follows.
              for (const source of byTest.get(reader) ?? [])
                if (sources[workspace].includes(source))
                  scoped(workspace, source);
            }
          }
        } else if (!relative.startsWith("src/")) {
          // A workspace-root file no mutation-run test reads is build or run
          // configuration, whose effect on the run cannot be bounded from the
          // code that references it.
          unavailable(workspace, `Impact cannot be bounded: ${relative}`);
        }
        // Otherwise it is an asset or module inside `src/` that no mutation-run
        // test reaches, so it cannot change a measurement — the scope simply
        // does not include it, exactly like documentation.
      }
      // API consumes built packages, which exclude their test files. Runtime
      // dependency changes have unbounded API impact.
      if (workspace.startsWith("packages/") && !testFile(relative))
        unavailable("apps/api", `Runtime dependency changed: ${file}`);
    } else if (/^packages\/(native-file-tools|bash-executor)\//u.test(file)) {
      if (!testFile(file))
        unavailable("apps/api", `Runtime dependency changed: ${file}`);
    } else if (!unrelated(file)) {
      for (const directory of mutationWorkspaces)
        unavailable(directory, `Impact cannot be bounded: ${file}`);
    }
  }
  for (const scope of Object.values(scopes)) {
    scope.files = [...new Set(scope.files)].sort();
    if (scope.mode === "scoped" && scope.files.length === 0)
      scope.mode = "skip";
  }
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
  const dependencies = [...workspaceDependencies(workspace, root)];
  const inputs = git(
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    root,
  )
    .split("\0")
    .filter(Boolean)
    .filter((file) => {
      if (
        documentation(file) ||
        qualityTooling(file) ||
        file.startsWith(".github/") ||
        /(^|\/)\.gitignore$/u.test(file) ||
        // The plan only READS the index; the scoping logic cannot change a
        // measurement, so changing it must not cost a full refresh.
        /^scripts\/mutation-(scope|sharding)(\.test)?\.mjs$/u.test(file)
      )
        return false;
      if (file.startsWith(`${workspace}/`)) {
        // Only the mutation configuration invalidates this workspace's index.
        // Fixtures, test doubles, migrations, generated artifacts and prompt
        // markdown are inputs a changed file is now *scoped* by — the plan
        // measures the tests that read them — so hashing their contents would
        // refuse a measurement the gate can actually take. Source content is
        // not hashed either, and it moves coverage far more often.
        return mutationConfiguration(
          workspace,
          file.slice(workspace.length + 1),
          root,
        );
      }
      if (/^(apps|packages)\//u.test(file))
        return (
          !testFile(file) &&
          dependencies.some((directory) => file.startsWith(`${directory}/`))
        );
      // Unknown repository-level inputs invalidate conservatively: a lockfile
      // or a root config can change how every workspace builds and runs.
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

const mutationConfigurationCache = new Map();

/**
 * The workspace's mutation configuration: the Stryker config and the Vitest
 * config it names. These decide which files are mutated and which tests run, so
 * a change to either can move every measurement and must invalidate the index.
 */
function mutationConfiguration(workspace, relative, root) {
  const key = `${workspace}`;
  if (!mutationConfigurationCache.has(key)) {
    let configFile;
    try {
      const config = JSON.parse(
        readFileSync(path.join(root, workspace, "stryker.config.json"), "utf8"),
      );
      configFile = config?.vitest?.configFile;
    } catch {
      configFile = undefined;
    }
    // The manifest pins the Stryker and Vitest versions, so the toolchain it
    // selects is part of the environment too.
    mutationConfigurationCache.set(
      key,
      new Set([
        "stryker.config.json",
        "package.json",
        ...(typeof configFile === "string" ? [configFile] : []),
      ]),
    );
  }
  return mutationConfigurationCache.get(key).has(relative);
}

export function repositoryRoot(cwd = process.cwd()) {
  return git(["rev-parse", "--show-toplevel"], cwd).trim();
}

export function readMutationScope(base, baselines, root = process.cwd()) {
  const sources = Object.fromEntries(
    mutationWorkspaces.map((workspace) => [
      workspace,
      mutationSourceFiles(path.join(root, workspace)),
    ]),
  );
  const scopesByRevision = new Map();
  return Object.fromEntries(
    mutationWorkspaces.map((workspace) => {
      const revision = typeof base === "string" ? base : base?.[workspace];
      if (
        revision === undefined ||
        (typeof base !== "string" && !hasCommit(revision, root))
      )
        return [
          workspace,
          {
            mode: "unavailable",
            files: [],
            reason: "No usable comparison revision",
          },
        ];
      if (!scopesByRevision.has(revision))
        scopesByRevision.set(
          revision,
          selectMutationScope(
            changedFiles(revision, root).filter(
              (file) => !mutationCommandsOnly(file, revision, root),
            ),
            sources,
            baselines,
            root,
          ),
        );
      return [workspace, scopesByRevision.get(revision)[workspace]];
    }),
  );
}
