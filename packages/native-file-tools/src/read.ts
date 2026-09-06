import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { NativeFileError, resolveReadTarget } from "./path";
import { streamFileWindow } from "./stream-read";
import type { ReadSuccess, FileFailure } from "./source-lines";
export * from "./source-lines";

export async function loadText(path: string): Promise<string> {
  // Nonblocking open prevents a FIFO from hanging before the descriptor check.
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
}): Promise<ReadSuccess | FileFailure> {
  try {
    const target = await resolveReadTarget(input.path);
    return await streamFileWindow(target);
  } catch (error) {
    if (error instanceof NativeFileError)
      return { status: "error", type: error.type, message: error.message };
    const missing =
      error instanceof Error && "code" in error && error.code === "ENOENT";
    return {
      status: "error",
      type: missing ? "not_found" : "executor_unavailable",
      message: missing ? "File not found." : "File could not be read.",
    };
  }
}
