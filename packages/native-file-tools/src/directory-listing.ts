import type { Dirent } from "node:fs";
import { MAX_RESULT_CODE_UNITS } from "./source-lines";
import { measureNativeModelOutput } from "./serialization";
import { NativeFileError } from "./path";

export const DIRECTORY_TRAVERSAL_BUDGET = 10_000;
export const DIRECTORY_CHILD_CAP = 20;

export type DirectoryPort = {
  lstat: (path: string) => Promise<{ isDirectory(): boolean }>;
  opendir: (path: string) => Promise<{
    read(): Promise<Dirent | null>;
    close(): Promise<void>;
  }>;
};

type EntryKind = "directory" | "file" | "symlink" | "special";

type DirEntry = {
  name: string;
  kind: EntryKind;
};

type ChildDir = {
  name: string;
  entries: DirEntry[];
  totalCount: number;
  overBudget: boolean;
};

export type DirectorySuccess = {
  status: "success";
  kind: "directory";
  path: string;
  content: string;
  truncated: boolean;
  nextOffset?: number;
};

export type DirectoryFailure = {
  status: "error";
  type: "directory_too_large";
  message: string;
  count: number;
};

function classifyEntry(entry: Dirent): EntryKind {
  if (entry.isSymbolicLink()) return "symlink";
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  return "special";
}

function formatEntry(entry: DirEntry, indent: string): string {
  switch (entry.kind) {
    case "directory":
      return `${indent}- ${entry.name}/`;
    case "symlink":
      return `${indent}- ${entry.name}@`;
    case "special":
      return `${indent}- ${entry.name}?`;
    default:
      return `${indent}- ${entry.name}`;
  }
}

function compareEntries(a: DirEntry, b: DirEntry): number {
  const aDir = a.kind === "directory" ? 0 : 1;
  const bDir = b.kind === "directory" ? 0 : 1;
  if (aDir !== bDir) return aDir - bDir;
  return a.name.localeCompare(b.name);
}

async function readDirEntries(
  port: DirectoryPort,
  dirPath: string,
): Promise<{ entries: DirEntry[]; totalCount: number; overBudget: boolean }> {
  const dir = await port.opendir(dirPath);
  try {
    const entries: DirEntry[] = [];
    let totalCount = 0;
    let overBudget = false;
    let dirent = await dir.read();
    while (dirent !== null) {
      totalCount += 1;
      if (!overBudget && entries.length < DIRECTORY_TRAVERSAL_BUDGET) {
        entries.push({ name: dirent.name, kind: classifyEntry(dirent) });
      } else {
        overBudget = true;
      }
      dirent = await dir.read();
    }
    return { entries, totalCount, overBudget };
  } finally {
    await dir.close();
  }
}

export async function listDirectory(
  targetPath: string,
  port: DirectoryPort,
  options?: { offset?: number; limit?: number },
): Promise<DirectorySuccess | DirectoryFailure> {
  const root = await readDirEntries(port, targetPath);

  if (root.overBudget) {
    return {
      status: "error",
      type: "directory_too_large",
      message: `Directory contains ${root.totalCount} entries, exceeding the ${DIRECTORY_TRAVERSAL_BUDGET} entry budget.`,
      count: root.totalCount,
    };
  }

  root.entries.sort(compareEntries);

  const isFlat = options?.offset !== undefined || options?.limit !== undefined;

  if (isFlat) {
    return renderFlatListing(targetPath, root.entries, options);
  }

  const children: ChildDir[] = [];
  for (const entry of root.entries) {
    if (entry.kind !== "directory") continue;
    const childPath = `${targetPath}/${entry.name}`;
    try {
      const child = await readDirEntries(port, childPath);
      child.entries.sort(compareEntries);
      children.push({
        name: entry.name,
        entries: child.entries,
        totalCount: child.totalCount,
        overBudget: child.overBudget,
      });
    } catch {
      children.push({
        name: entry.name,
        entries: [],
        totalCount: 0,
        overBudget: false,
      });
    }
  }

  return renderTreeListing(targetPath, root.entries, children);
}

function renderFlatListing(
  targetPath: string,
  entries: DirEntry[],
  options?: { offset?: number; limit?: number },
): DirectorySuccess {
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? entries.length;
  const end = Math.min(offset + limit, entries.length);
  const selected = entries.slice(offset, end);

  const lines: string[] = [targetPath];
  for (const entry of selected) {
    lines.push(formatEntry(entry, "  "));
  }
  const content = lines.join("\n") + "\n";

  const result: DirectorySuccess = {
    status: "success",
    kind: "directory",
    path: targetPath,
    content,
    truncated: end < entries.length,
  };
  if (end < entries.length) {
    result.nextOffset = end;
  }
  return boundDirectoryResult(result);
}

function renderTreeListing(
  targetPath: string,
  rootEntries: DirEntry[],
  children: ChildDir[],
): DirectorySuccess {
  if (rootEntries.length === 0) {
    return {
      status: "success",
      kind: "directory",
      path: targetPath,
      content: `${targetPath}\n(empty directory)\n`,
      truncated: false,
    };
  }

  const childMap = new Map<string, ChildDir>();
  for (const child of children) {
    childMap.set(child.name, child);
  }

  type ChildBlock = {
    name: string;
    headerLine: string;
    childLines: string[];
    totalCount: number;
  };
  const childBlocks: ChildBlock[] = [];

  const lines: string[] = [targetPath];
  for (const entry of rootEntries) {
    const headerLine = formatEntry(entry, "  ");
    lines.push(headerLine);
    if (entry.kind === "directory") {
      const child = childMap.get(entry.name);
      if (child) {
        const block = renderChildBlock(child);
        childBlocks.push({
          name: entry.name,
          headerLine,
          childLines: block.lines,
          totalCount: child.totalCount,
        });
        for (const line of block.lines) {
          lines.push(line);
        }
      }
    }
  }

  let content = lines.join("\n") + "\n";
  let truncated = false;

  if (
    measureNativeModelOutput({
      status: "success",
      kind: "directory",
      path: targetPath,
      content,
      truncated: false,
    }) > MAX_RESULT_CODE_UNITS
  ) {
    const result = elideChildBlocks(targetPath, rootEntries, childBlocks);
    content = result.content;
    truncated = result.truncated;
  }

  if (
    measureNativeModelOutput({
      status: "success",
      kind: "directory",
      path: targetPath,
      content,
      truncated,
    }) > MAX_RESULT_CODE_UNITS
  ) {
    return truncateRequestedLevel(targetPath, rootEntries, childBlocks);
  }

  return {
    status: "success",
    kind: "directory",
    path: targetPath,
    content,
    truncated,
  };
}

function renderChildBlock(child: ChildDir): { lines: string[] } {
  const indent = "    ";
  const lines: string[] = [];

  if (child.overBudget) {
    lines.push(`${indent}… ${child.totalCount} entries`);
    return { lines };
  }

  const cap = DIRECTORY_CHILD_CAP;
  const shown = child.entries.slice(0, cap);
  for (const entry of shown) {
    lines.push(formatEntry(entry, indent));
  }
  if (child.entries.length > cap) {
    lines.push(`${indent}… ${child.entries.length - cap} more`);
  }

  return { lines };
}

type ChildBlockInfo = {
  name: string;
  headerLine: string;
  childLines: string[];
  totalCount: number;
};

function elideChildBlocks(
  targetPath: string,
  rootEntries: DirEntry[],
  childBlocks: ChildBlockInfo[],
): { content: string; truncated: boolean } {
  const elided = new Set<string>();
  const blocksByName = new Map<string, ChildBlockInfo>();
  for (const block of childBlocks) {
    blocksByName.set(block.name, block);
  }

  const reversedBlocks = [...childBlocks].reverse();
  for (const block of reversedBlocks) {
    if (block.childLines.length === 0) continue;

    elided.add(block.name);
    const content = buildContent(targetPath, rootEntries, blocksByName, elided);

    if (
      measureNativeModelOutput({
        status: "success",
        kind: "directory",
        path: targetPath,
        content,
        truncated: true,
      }) <= MAX_RESULT_CODE_UNITS
    ) {
      return { content, truncated: true };
    }
  }

  const content = buildContent(targetPath, rootEntries, blocksByName, elided);
  return { content, truncated: true };
}

function buildContent(
  targetPath: string,
  rootEntries: DirEntry[],
  blocksByName: Map<string, ChildBlockInfo>,
  elided: Set<string>,
): string {
  const lines: string[] = [targetPath];
  for (const entry of rootEntries) {
    lines.push(formatEntry(entry, "  "));
    if (entry.kind === "directory") {
      const block = blocksByName.get(entry.name);
      if (block) {
        if (elided.has(entry.name)) {
          if (block.totalCount > 0) {
            lines.push(`    … ${block.totalCount} entries`);
          }
        } else {
          for (const line of block.childLines) {
            lines.push(line);
          }
        }
      }
    }
  }
  return lines.join("\n") + "\n";
}

function truncateRequestedLevel(
  targetPath: string,
  rootEntries: DirEntry[],
  childBlocks: ChildBlockInfo[],
): DirectorySuccess {
  const blocksByName = new Map<string, ChildBlockInfo>();
  for (const block of childBlocks) {
    blocksByName.set(block.name, block);
  }
  const allElided = new Set(
    childBlocks.filter((b) => b.childLines.length > 0).map((b) => b.name),
  );

  let entryIndex = 0;
  const lines: string[] = [targetPath];
  for (const entry of rootEntries) {
    const entryLine = formatEntry(entry, "  ");
    const markerLine =
      entry.kind === "directory"
        ? markerForElided(blocksByName.get(entry.name), allElided)
        : undefined;

    const candidateLines = [...lines, entryLine];
    if (markerLine) candidateLines.push(markerLine);
    const candidateContent = candidateLines.join("\n") + "\n";

    const nextIdx = entryIndex + 1;
    if (
      measureNativeModelOutput({
        status: "success",
        kind: "directory",
        path: targetPath,
        content: candidateContent,
        truncated: true,
        nextOffset: nextIdx,
      }) > MAX_RESULT_CODE_UNITS
    ) {
      return {
        status: "success",
        kind: "directory",
        path: targetPath,
        content: lines.join("\n") + "\n",
        truncated: true,
        nextOffset: entryIndex,
      };
    }

    lines.push(entryLine);
    if (markerLine) lines.push(markerLine);
    entryIndex += 1;
  }

  return {
    status: "success",
    kind: "directory",
    path: targetPath,
    content: lines.join("\n") + "\n",
    truncated: false,
  };
}

function markerForElided(
  block: ChildBlockInfo | undefined,
  elided: Set<string>,
): string | undefined {
  if (!block) return undefined;
  if (!elided.has(block.name)) return undefined;
  if (block.totalCount === 0) return undefined;
  return `    … ${block.totalCount} entries`;
}

function boundDirectoryResult(result: DirectorySuccess): DirectorySuccess {
  if (measureNativeModelOutput(result) <= MAX_RESULT_CODE_UNITS) return result;

  const lines = result.content.split("\n");
  while (
    lines.length > 1 &&
    measureNativeModelOutput({
      ...result,
      content: lines.join("\n") + "\n",
      truncated: true,
    }) > MAX_RESULT_CODE_UNITS
  ) {
    lines.pop();
  }

  const header = result.content.split("\n")[0];
  const entryLines = lines.slice(1).filter((l) => l.length > 0);

  result.content = lines.join("\n") + "\n";
  result.truncated = true;
  result.nextOffset =
    (result.nextOffset ?? 0) > 0
      ? result.nextOffset
      : entryLines.length + (result.nextOffset ?? 0);
  return result;
}
