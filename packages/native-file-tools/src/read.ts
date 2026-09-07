import { constants } from "node:fs";
import { lstat, opendir, open } from "node:fs/promises";
import { NativeFileError, resolveReadTarget } from "./path";
import { streamFileWindow } from "./stream-read";
import {
  listDirectory,
  type DirectoryPort,
  type DirectorySuccess,
  type DirectoryFailure,
} from "./directory-listing";
import type { ReadSuccess, FileFailure } from "./source-lines";
export * from "./source-lines";
export type { DirectorySuccess, DirectoryFailure } from "./directory-listing";
export {
  DIRECTORY_TRAVERSAL_BUDGET,
  DIRECTORY_CHILD_CAP,
} from "./directory-listing";

const NODE_DIRECTORY_PORT: DirectoryPort = {
  lstat: (path) => lstat(path),
  opendir: (path) => opendir(path),
};

export async function loadText(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new NativeFileError("not_regular_file");
    const buffer = await file.readFile();
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        buffer,
      );
    } catch {
      throw new NativeFileError("invalid_utf8");
    }
  } finally {
    await file.close();
  }
}

export async function readFile(input: {
  path: string;
}): Promise<ReadSuccess | DirectorySuccess | DirectoryFailure | FileFailure> {
  try {
    const target = await resolveReadTarget(input.path);
    if (target.directory) {
      if (target.raw)
        return {
          status: "error",
          type: "invalid_selector",
          message: "The :raw selector is not supported for directory reads.",
        };
      const options =
        target.offset > 0 || target.limit !== undefined
          ? { offset: target.offset, limit: target.limit }
          : undefined;
      return await listDirectory(target.path, NODE_DIRECTORY_PORT, options);
    }
    return await streamFileWindow(target);
  } catch (error) {
    if (error instanceof NativeFileError)
      return { status: "error", type: error.type, message: error.message };
    const code =
      error instanceof Error && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    const type =
      code === "ENOENT" || code === "ENOTDIR"
        ? "not_found"
        : "executor_unavailable";
    return {
      status: "error",
      type,
      message:
        type === "not_found" ? "File not found." : "File could not be read.",
    };
  }
}
