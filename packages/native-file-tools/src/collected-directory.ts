import {
  compareEntries,
  DIRECTORY_TRAVERSAL_BUDGET,
  renderCollectedDirectoryParts,
  type ChildDir,
  type DirEntry,
  type DirectoryFailure,
  type DirectoryListingOptions,
  type DirectorySuccess,
} from "./directory-listing";

export type DirectoryListingEntry = {
  readonly name: string;
  readonly kind: "directory" | "file" | "symlink" | "special";
  readonly children?: ReadonlyArray<DirectoryListingEntry>;
};

export function renderCollectedDirectory(
  targetPath: string,
  entries: ReadonlyArray<DirectoryListingEntry>,
  options?: DirectoryListingOptions,
): DirectorySuccess | DirectoryFailure {
  const roots = entries.map(toDirEntry);
  const sourceByName = new Map(entries.map((entry) => [entry.name, entry]));
  const children: Array<ChildDir> = [];
  for (const root of roots) {
    if (root.kind !== "directory") continue;
    children.push(childDirectory(root.name, sourceByName.get(root.name)));
  }
  return renderCollectedDirectoryParts(targetPath, roots, children, options);
}

function toDirEntry(entry: DirectoryListingEntry): DirEntry {
  return { name: entry.name, kind: entry.kind };
}

function childDirectory(
  name: string,
  source: DirectoryListingEntry | undefined,
): ChildDir {
  const entries = (source?.children ?? []).map(toDirEntry);
  entries.sort(compareEntries);
  const totalCount = entries.length;
  const overBudget = totalCount > DIRECTORY_TRAVERSAL_BUDGET;
  return {
    name,
    entries: overBudget
      ? entries.slice(0, DIRECTORY_TRAVERSAL_BUDGET)
      : entries,
    totalCount,
    overBudget,
  };
}
