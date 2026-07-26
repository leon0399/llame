import { lstat } from "node:fs/promises";
import path from "node:path";

export function validateArchiveOutputPath(outputPath, packageRoot) {
  if (!path.isAbsolute(outputPath)) {
    throw new Error("Archive output path must be absolute.");
  }
  if (path.normalize(outputPath) !== outputPath) {
    throw new Error("Archive output path must be normalized and unambiguous.");
  }
  if (!outputPath.endsWith(".tgz") || path.basename(outputPath) === ".tgz") {
    throw new Error("Archive output path must name a .tgz file.");
  }
  if (
    outputPath === packageRoot ||
    outputPath.startsWith(`${packageRoot}${path.sep}`)
  ) {
    throw new Error(
      "Archive output path must be outside the package workspace.",
    );
  }
  return outputPath;
}

export async function assertArchiveTargetAbsent(outputPath) {
  try {
    await lstat(outputPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error("Archive output path already exists; refusing to overwrite.");
}
