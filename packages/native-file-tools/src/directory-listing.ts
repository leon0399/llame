import type { Dirent } from "node:fs";
import { MAX_RESULT_CODE_UNITS } from "./source-lines";
import { measureNativeModelOutput } from "./serialization";

export const DIRECTORY_TRAVERSAL_BUDGET = 10_000;
export const DIRECTORY_CHILD_CAP = 20;

export type DirectoryPort = {
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
  entries: Array<DirEntry>;
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

type ChildBlockInfo = {
  name: string;
  childLines: Array<string>;
  totalCount: number;
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

function elisionMarker(totalCount: number): string | undefined {
  return totalCount > 0 ? `    … ${totalCount} entries` : undefined;
}

async function readDirEntries(
  port: DirectoryPort,
  dirPath: string,
): Promise<{
  entries: Array<DirEntry>;
  totalCount: number;
  overBudget: boolean;
}> {
  const dir = await port.opendir(dirPath);
  try {
    const entries: Array<DirEntry> = [];
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

function fitsResultCap(candidate: DirectorySuccess): boolean {
  return measureNativeModelOutput(candidate) <= MAX_RESULT_CODE_UNITS;
}

function directoryResult(
  targetPath: string,
  content: string,
  truncated: boolean,
  nextOffset?: number,
): DirectorySuccess {
  const result: DirectorySuccess = {
    status: "success",
    kind: "directory",
    path: targetPath,
    content,
    truncated,
  };
  if (nextOffset !== undefined) result.nextOffset = nextOffset;
  return result;
}

async function readChildDirs(
  rootEntries: Array<DirEntry>,
  targetPath: string,
  port: DirectoryPort,
): Promise<Array<ChildDir>> {
  const dirEntries = rootEntries.filter((e) => e.kind === "directory");
  return Promise.all(
    dirEntries.map(async (entry) => {
      const childPath = `${targetPath}/${entry.name}`;
      try {
        const child = await readDirEntries(port, childPath);
        child.entries.sort(compareEntries);
        return {
          name: entry.name,
          entries: child.entries,
          totalCount: child.totalCount,
          overBudget: child.overBudget,
        };
      } catch {
        // Unreadable child renders as empty; no distinguishing marker in this iteration.
        return {
          name: entry.name,
          entries: [],
          totalCount: 0,
          overBudget: false,
        };
      }
    }),
  );
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

  if (options?.offset !== undefined || options?.limit !== undefined) {
    return renderFlatListing(targetPath, root.entries, options);
  }

  const children = await readChildDirs(root.entries, targetPath, port);
  return renderTreeListing(targetPath, root.entries, children);
}

function renderFlatListing(
  targetPath: string,
  entries: Array<DirEntry>,
  options?: { offset?: number; limit?: number },
): DirectorySuccess {
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? entries.length;
  const end = Math.min(offset + limit, entries.length);
  const selected = entries.slice(offset, end);

  const lines: Array<string> = [targetPath];
  for (const entry of selected) {
    lines.push(formatEntry(entry, "  "));
  }
  const content = lines.join("\n") + "\n";

  const result = directoryResult(
    targetPath,
    content,
    end < entries.length,
    end < entries.length ? end : undefined,
  );
  return boundFlatResult(result, offset);
}

function renderChildBlock(child: ChildDir) {
  const indent = "    ";
  const lines: Array<string> = [];

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

function assembleTreeLines(
  targetPath: string,
  rootEntries: Array<DirEntry>,
  childMap: Map<string, ChildDir>,
) {
  const childBlocks: Array<ChildBlockInfo> = [];
  const lines: Array<string> = [targetPath];

  for (const entry of rootEntries) {
    lines.push(formatEntry(entry, "  "));
    if (entry.kind !== "directory") continue;
    const child = childMap.get(entry.name);
    if (!child) continue;
    const block = renderChildBlock(child);
    childBlocks.push({
      name: entry.name,
      childLines: block.lines,
      totalCount: child.totalCount,
    });
    for (const line of block.lines) lines.push(line);
  }

  return { lines, childBlocks };
}

function renderTreeListing(
  targetPath: string,
  rootEntries: Array<DirEntry>,
  children: Array<ChildDir>,
): DirectorySuccess {
  if (rootEntries.length === 0) {
    return directoryResult(
      targetPath,
      `${targetPath}\n(empty directory)\n`,
      false,
    );
  }

  const childMap = new Map<string, ChildDir>();
  for (const child of children) childMap.set(child.name, child);

  const { lines, childBlocks } = assembleTreeLines(
    targetPath,
    rootEntries,
    childMap,
  );
  let content = lines.join("\n") + "\n";
  let truncated = false;

  if (!fitsResultCap(directoryResult(targetPath, content, false))) {
    const elided = elideChildBlocks(targetPath, rootEntries, childBlocks);
    content = elided.content;
    truncated = elided.truncated;
  }

  if (!fitsResultCap(directoryResult(targetPath, content, truncated))) {
    return truncateRequestedLevel(targetPath, rootEntries, childBlocks);
  }

  return directoryResult(targetPath, content, truncated);
}

function elideChildBlocks(
  targetPath: string,
  rootEntries: Array<DirEntry>,
  childBlocks: Array<ChildBlockInfo>,
) {
  const elided = new Set<string>();
  const blocksByName = new Map<string, ChildBlockInfo>();
  for (const block of childBlocks) blocksByName.set(block.name, block);

  for (const block of [...childBlocks].reverse()) {
    if (block.childLines.length === 0) continue;
    elided.add(block.name);
    const content = buildContent(targetPath, rootEntries, blocksByName, elided);
    if (fitsResultCap(directoryResult(targetPath, content, true))) {
      return { content, truncated: true };
    }
  }

  return {
    content: buildContent(targetPath, rootEntries, blocksByName, elided),
    truncated: true,
  };
}

function buildContent(
  targetPath: string,
  rootEntries: Array<DirEntry>,
  blocksByName: Map<string, ChildBlockInfo>,
  elided: Set<string>,
): string {
  const lines: Array<string> = [targetPath];
  for (const entry of rootEntries) {
    lines.push(formatEntry(entry, "  "));
    if (entry.kind !== "directory") continue;
    const block = blocksByName.get(entry.name);
    if (!block) continue;
    if (elided.has(entry.name)) {
      const marker = elisionMarker(block.totalCount);
      if (marker) lines.push(marker);
    } else {
      for (const line of block.childLines) lines.push(line);
    }
  }
  return lines.join("\n") + "\n";
}

function indexChildBlocks(childBlocks: Array<ChildBlockInfo>) {
  const byName = new Map<string, ChildBlockInfo>();
  for (const block of childBlocks) byName.set(block.name, block);
  const elided = new Set(
    childBlocks.filter((b) => b.childLines.length > 0).map((b) => b.name),
  );
  return { byName, elided };
}

function truncateRequestedLevel(
  targetPath: string,
  rootEntries: Array<DirEntry>,
  childBlocks: Array<ChildBlockInfo>,
): DirectorySuccess {
  const { byName, elided } = indexChildBlocks(childBlocks);

  let entryIndex = 0;
  const lines: Array<string> = [targetPath];
  for (const entry of rootEntries) {
    const entryLine = formatEntry(entry, "  ");
    const block =
      entry.kind === "directory" ? byName.get(entry.name) : undefined;
    const marker =
      block && elided.has(block.name)
        ? elisionMarker(block.totalCount)
        : undefined;

    const candidate = [...lines, entryLine];
    if (marker) candidate.push(marker);
    const nextIdx = entryIndex + 1;
    if (
      !fitsResultCap(
        directoryResult(targetPath, candidate.join("\n") + "\n", true, nextIdx),
      )
    ) {
      return directoryResult(
        targetPath,
        lines.join("\n") + "\n",
        true,
        entryIndex,
      );
    }

    lines.push(entryLine);
    if (marker) lines.push(marker);
    entryIndex += 1;
  }

  return directoryResult(targetPath, lines.join("\n") + "\n", false);
}

function boundFlatResult(
  result: DirectorySuccess,
  requestOffset: number,
): DirectorySuccess {
  if (fitsResultCap(result)) return result;

  const lines = result.content.split("\n");
  while (
    lines.length > 1 &&
    !fitsResultCap({
      ...result,
      content: lines.join("\n") + "\n",
      truncated: true,
    })
  ) {
    lines.pop();
  }

  const keptEntries = lines.slice(1).filter((l) => l.length > 0).length;
  return directoryResult(
    result.path,
    lines.join("\n") + "\n",
    true,
    requestOffset + keptEntries,
  );
}
