import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import {
  isNumber,
  isRecord,
  isString,
  type BaseToolContext,
  type Tool,
  type ToolResult,
} from "@workspace/harness";

/** CLI tool contexts bind only the workspace root. */
type ToolContext = BaseToolContext;

const execAsync = promisify(exec);

/** Largest file `read_file` will open — bigger payloads need narrower asks. */
const MAX_READ_BYTES = 1_000_000;
/** Most entries `list_dir` reports before it stops listing. */
const MAX_DIR_ENTRIES = 500;
/** Longest a bash tool call may run, regardless of what the model asked for. */
const MAX_BASH_TIMEOUT_SECONDS = 120;

/**
 * Resolve a model-supplied path against the trusted workspace root. A CLI
 * Run advertises only the directory in which it was started (VISION.md):
 * anything that escapes it is refused here, before any tool logic runs.
 * Returns undefined when the path escapes the workspace.
 */
export function resolveWithin(
  workspaceRoot: string,
  requested: string,
): string | undefined {
  const absolute = path.resolve(workspaceRoot, requested);
  if (
    absolute !== workspaceRoot &&
    !absolute.startsWith(workspaceRoot + path.sep)
  ) {
    return undefined;
  }
  return absolute;
}

function outsideWorkspace(toolId: string): ToolResult {
  return {
    status: "error",
    type: "outside_workspace",
    message: `Tool "${toolId}" refused: the path resolves outside the workspace root.`,
  };
}

const read_file = (workspaceRoot: string): Tool<{ path: string }> => ({
  id: "read_file",
  description:
    "Read a text file from the workspace. Path is relative to the workspace root.",
  classification: "read_only",
  inputSchema: z.object({ path: z.string().min(1) }).strict(),
  execute: async (_context, { path: requested }) => {
    const filePath = resolveWithin(workspaceRoot, requested);
    if (!filePath) return outsideWorkspace("read_file");
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > MAX_READ_BYTES) {
        return {
          status: "error",
          type: "too_large",
          message: `File exceeds the ${MAX_READ_BYTES}-byte read cap.`,
        };
      }
      const content = await fs.readFile(filePath, "utf8");
      return { status: "success", path: requested, content };
    } catch {
      return {
        status: "error",
        type: "not_found",
        message: `File "${requested}" could not be read.`,
      };
    }
  },
});

const list_dir = (workspaceRoot: string): Tool<{ path?: string }> => ({
  id: "list_dir",
  description:
    "List a directory in the workspace (defaults to the root). Entries beyond the cap are omitted and counted.",
  classification: "read_only",
  inputSchema: z.object({ path: z.string().min(1).optional() }).strict(),
  execute: async (_context, { path: requested }) => {
    const dirPath = resolveWithin(workspaceRoot, requested ?? ".");
    if (!dirPath) return outsideWorkspace("list_dir");
    let dirents;
    try {
      dirents = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return {
        status: "error",
        type: "not_found",
        message: `Directory "${requested ?? "."}" could not be read.`,
      };
    }
    const entries = dirents
      .slice(0, MAX_DIR_ENTRIES)
      .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`);
    return {
      status: "success",
      path: requested ?? ".",
      entries,
      ...(dirents.length > MAX_DIR_ENTRIES && {
        omittedCount: dirents.length - MAX_DIR_ENTRIES,
      }),
    };
  },
});

const write_file = (
  workspaceRoot: string,
): Tool<{ path: string; content: string }> => ({
  id: "write_file",
  description:
    "Create or overwrite a text file in the workspace (requires approval). Parent directories are created.",
  classification: "write_low_risk",
  inputSchema: z
    .object({ path: z.string().min(1), content: z.string() })
    .strict(),
  execute: async (_context, { path: requested, content }) => {
    const filePath = resolveWithin(workspaceRoot, requested);
    if (!filePath) return outsideWorkspace("write_file");
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
      return {
        status: "success",
        path: requested,
        bytesWritten: Buffer.byteLength(content),
      };
    } catch {
      return {
        status: "error",
        type: "write_failed",
        message: `File "${requested}" could not be written.`,
      };
    }
  },
});

const edit_file = (
  workspaceRoot: string,
): Tool<{ path: string; oldText: string; newText: string }> => ({
  id: "edit_file",
  description:
    "Replace one exact occurrence of oldText with newText in a workspace file (requires approval). Refuses when the text appears zero or multiple times.",
  classification: "write_low_risk",
  inputSchema: z
    .object({
      path: z.string().min(1),
      oldText: z.string().min(1),
      newText: z.string(),
    })
    .strict(),
  execute: async (_context, { path: requested, oldText, newText }) => {
    const filePath = resolveWithin(workspaceRoot, requested);
    if (!filePath) return outsideWorkspace("edit_file");
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      return {
        status: "error",
        type: "not_found",
        message: `File "${requested}" could not be read.`,
      };
    }
    const first = content.indexOf(oldText);
    if (first === -1) {
      return {
        status: "error",
        type: "not_found",
        message: `oldText does not appear in "${requested}".`,
      };
    }
    if (content.indexOf(oldText, first + 1) !== -1) {
      return {
        status: "error",
        type: "ambiguous_match",
        message: `oldText appears multiple times in "${requested}"; provide more surrounding context.`,
      };
    }
    const updated =
      content.slice(0, first) + newText + content.slice(first + oldText.length);
    try {
      await fs.writeFile(filePath, updated, "utf8");
    } catch {
      return {
        status: "error",
        type: "write_failed",
        message: `File "${requested}" could not be written.`,
      };
    }
    return { status: "success", path: requested };
  },
});

const bash = (
  workspaceRoot: string,
): Tool<{ command: string; timeoutSeconds?: number }> => ({
  id: "bash",
  description:
    "Run a shell command inside the workspace root and capture stdout/stderr/exit code (requires approval).",
  classification: "execute_code",
  timeoutSeconds: 60,
  inputSchema: z
    .object({
      command: z.string().min(1),
      timeoutSeconds: z
        .number()
        .int()
        .min(1)
        .max(MAX_BASH_TIMEOUT_SECONDS)
        .optional(),
    })
    .strict(),
  execute: async (context: ToolContext, { command, timeoutSeconds }) => {
    try {
      const result = await execAsync(command, {
        cwd: workspaceRoot,
        timeout: (timeoutSeconds ?? 60) * 1000,
        maxBuffer: 1_000_000,
        signal: context.abortSignal,
        env: { ...process.env },
      });
      return {
        status: "success",
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      if (context.abortSignal?.aborted) {
        return {
          status: "error",
          type: "cancelled",
          message: 'Command "bash" was cancelled.',
        };
      }
      // Non-zero exit is an observation for the model, not a crash. Only
      // well-known fields of the exec error are read, via narrow guards.
      const err = isRecord(error) ? error : {};
      const code = isNumber(err.code) ? err.code : 1;
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- this local IS the boundary check for exec-error fields; each use validates via isString.
      const asText = (value: unknown): string => (isString(value) ? value : "");
      return {
        status: "success",
        exitCode: code,
        stdout: asText(err.stdout),
        stderr: asText(err.stderr) || asText(err.message),
      };
    }
  },
});

/** The five coding tools every CLI session advertises, bound to the cwd. */
export function createCodingTools(workspaceRoot: string): Map<string, Tool> {
  const registry = new Map<string, Tool>();
  for (const tool of [
    read_file(workspaceRoot),
    list_dir(workspaceRoot),
    write_file(workspaceRoot),
    edit_file(workspaceRoot),
    bash(workspaceRoot),
  ]) {
    registry.set(tool.id, tool);
  }
  return registry;
}
