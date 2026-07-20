import { realpath } from "node:fs/promises";
import path from "node:path";

export interface ResolveArtifactPathsOptions {
  cwd: string;
  storyRoots: string[];
  importPath: string;
  storyId: string;
  environmentKey: string;
}

export interface ArtifactPaths {
  artifactRoot: string;
  storyPath: string;
  directory: string;
  baselinePath: string;
  baselineMetadataPath: string;
  candidatePath: string;
  diffPath: string;
  resultPath: string;
}

export async function resolveArtifactPaths(
  options: ResolveArtifactPathsOptions,
): Promise<ArtifactPaths> {
  const importPath = normalizeImportPath(options.importPath);
  assertPathSegment("story ID", options.storyId);
  assertPathSegment("environment key", options.environmentKey);

  if (options.storyRoots.length === 0) {
    throw new Error("At least one story root is required");
  }

  const storyPath = await realpath(path.resolve(options.cwd, importPath));
  const roots = await Promise.all(
    options.storyRoots.map((root) =>
      realpath(path.resolve(options.cwd, root)).then((resolved) =>
        path.normalize(resolved),
      ),
    ),
  );
  const artifactRoot = roots.find((root) => isWithin(root, storyPath));
  if (!artifactRoot) {
    throw new Error("Story resolves outside the configured story roots");
  }

  const directory = path.join(
    path.dirname(storyPath),
    "__screenshots__",
    `${path.basename(storyPath)}.visual`,
    options.storyId,
    options.environmentKey,
  );
  await assertPathConfined(artifactRoot, directory);

  return {
    artifactRoot,
    storyPath,
    directory,
    baselinePath: path.join(directory, "baseline.png"),
    baselineMetadataPath: path.join(directory, "baseline.json"),
    candidatePath: path.join(directory, "candidate.png"),
    diffPath: path.join(directory, "diff.png"),
    resultPath: path.join(directory, "result.json"),
  };
}

export async function assertPathConfined(
  root: string,
  target: string,
): Promise<void> {
  const resolvedRoot = await realpath(root);
  const absoluteTarget = path.resolve(target);
  if (!isWithin(resolvedRoot, absoluteTarget)) {
    throw new Error("Path resolves outside the configured artifact root");
  }

  let ancestor = absoluteTarget;
  while (true) {
    try {
      const resolvedAncestor = await realpath(ancestor);
      if (!isWithin(resolvedRoot, resolvedAncestor)) {
        throw new Error("Path resolves outside the configured artifact root");
      }
      return;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        throw new Error(
          "Could not resolve an ancestor inside the artifact root",
        );
      }
      ancestor = parent;
    }
  }
}

function normalizeImportPath(importPath: string): string {
  if (importPath.includes("\0")) throw new Error("Invalid story import path");
  const normalizedSeparators = importPath.replaceAll("\\", "/");
  if (
    path.posix.isAbsolute(normalizedSeparators) ||
    path.win32.isAbsolute(importPath)
  ) {
    throw new Error("Story import path must be relative");
  }

  const segments = normalizedSeparators.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error("Story import path cannot traverse its working directory");
  }

  const normalized = path.posix.normalize(normalizedSeparators);
  if (normalized === "." || normalized === "") {
    throw new Error("Story import path must name a file");
  }
  return normalized;
}

function assertPathSegment(name: string, value: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    throw new Error(`Invalid ${name}`);
  }
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
