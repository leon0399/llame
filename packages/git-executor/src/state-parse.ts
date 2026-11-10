import { posix } from "node:path";

import type { GitStateSuccess } from "@workspace/machine-protocol";

/*
 * The pure half of `git.state`: `status --porcelain=v2 -z` records, `log`
 * records, and the root-relative, bounded layout of the changed paths.
 */

type Entry = GitStateSuccess["entries"][number];

type Counts = GitStateSuccess["counts"];

export type ParsedStatus = {
  readonly head: string | null;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly upstream: string | null;
  readonly ab: { readonly ahead: number; readonly behind: number } | null;
  readonly counts: Counts;
  /** Toplevel-relative paths, in git's order. */
  readonly entries: ReadonlyArray<Entry>;
};

/** The text after the first `skip` spaces: the path of a record keeps its own
 *  spaces. */
function afterFields(record: string, skip: number): string {
  let index = -1;

  for (let seen = 0; seen < skip; seen += 1) {
    index = record.indexOf(" ", index + 1);

    if (index === -1) return "";
  }

  return record.slice(index + 1);
}

function porcelainXy(value: string): string {
  return value.replaceAll(".", " ");
}

type Header = Pick<
  ParsedStatus,
  "head" | "branch" | "detached" | "upstream" | "ab"
>;

function parseHeaders(records: ReadonlyArray<string>): Header {
  let head: string | null = null;
  let branch: string | null = null;
  let detached = false;
  let upstream: string | null = null;
  let ab: Header["ab"] = null;

  for (const record of records) {
    // Headers lead the output; a later `# ` is a path, never a header.
    if (!record.startsWith("# ")) break;
    const [key = "", ...rest] = record.slice(2).split(" ");
    const value = rest.join(" ");

    if (key === "branch.oid" && value !== "(initial)") head = value;

    if (key === "branch.head") {
      detached = value === "(detached)";
      branch = detached ? null : value;
    }

    if (key === "branch.upstream") upstream = value;

    if (key === "branch.ab") {
      const [ahead = "", behind = ""] = value.split(" ");
      ab = {
        ahead: Number.parseInt(ahead.slice(1), 10),
        behind: Number.parseInt(behind.slice(1), 10),
      };
    }
  }

  return { head, branch, detached, upstream, ab };
}

/** Parse the NUL-separated records of `status --porcelain=v2 --branch -z`. */
export function parseStatus(stdout: string): ParsedStatus {
  const records = stdout.split("\0");
  const counts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  const entries: Array<Entry> = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    const kind = record.slice(0, 2);
    const xy = record.slice(2, 4);

    if (kind === "1 " || kind === "2 ") {
      if (xy[0] !== ".") counts.staged += 1;

      if (xy[1] !== ".") counts.unstaged += 1;
    }

    if (kind === "1 ") {
      entries.push({ xy: porcelainXy(xy), path: afterFields(record, 8) });
    } else if (kind === "2 ") {
      index += 1;
      entries.push({
        xy: porcelainXy(xy),
        path: afterFields(record, 9),
        from: records[index] ?? "",
      });
    } else if (kind === "u ") {
      counts.conflicted += 1;
      entries.push({ xy, path: afterFields(record, 10) });
    } else if (kind === "? ") {
      counts.untracked += 1;
      entries.push({ xy: "??", path: record.slice(2) });
    }
  }

  return { ...parseHeaders(records), counts, entries };
}

/** `log --format=%h%x00%s%x00`: one short id and one subject per commit. */
export function parseCommits(stdout: string): GitStateSuccess["commits"] {
  const fields = stdout.split("\0");
  const commits: Array<GitStateSuccess["commits"][number]> = [];

  for (let index = 0; index + 1 < fields.length; index += 2) {
    // Each record ends in a newline that leads the next one.
    const short = (fields[index] ?? "").replace(/^\n/u, "");

    if (short !== "") commits.push({ short, subject: fields[index + 1] ?? "" });
  }

  return commits;
}

/** The `path` values of `config --null --get-regexp` over `.gitmodules`. */
export function parseSubmodulePaths(stdout: string): Array<string> {
  const paths: Array<string> = [];

  for (const record of stdout.split("\0")) {
    const separator = record.indexOf("\n");

    if (separator !== -1) paths.push(record.slice(separator + 1));
  }

  return paths;
}

/** `origin/main@{1794097319}` to an ISO UTC time; `null` for empty output. */
export function reflogTime(stdout: string): string | null {
  const seconds = /@\{(\d+)\}\s*$/u.exec(stdout)?.[1];

  return seconds === undefined
    ? null
    : new Date(Number(seconds) * 1000).toISOString();
}

/** A toplevel-relative path, relative to the root; a trailing `/` stays. */
function rootRelative(rootPath: string, path: string): string {
  const relative = posix.relative(`/${rootPath}`, `/${path}`);

  if (!path.endsWith("/")) return relative;

  return relative === "" ? "./" : `${relative}/`;
}

function isInside(path: string): boolean {
  return path !== ".." && !path.startsWith("../");
}

/** Paths under the root first, git's order inside each group. */
function rootFirst<T>(
  items: ReadonlyArray<T>,
  path: (item: T) => string,
): Array<T> {
  return [
    ...items.filter((item) => isInside(path(item))),
    ...items.filter((item) => !isInside(path(item))),
  ];
}

export type Layout = {
  readonly entries: GitStateSuccess["entries"];
  readonly submodules: ReadonlyArray<string>;
  readonly omitted: number;
};

/**
 * Convert to root-relative paths and keep at most `limit` of them: changed
 * paths first, then the submodule paths that no changed path already names.
 */
export function layoutPaths(
  rootPath: string,
  entries: ReadonlyArray<Entry>,
  submodulePaths: ReadonlyArray<string>,
  limit: number,
): Layout {
  const relative = entries.map((entry): Entry => {
    const path = rootRelative(rootPath, entry.path);

    return entry.from === undefined
      ? { xy: entry.xy, path }
      : { xy: entry.xy, path, from: rootRelative(rootPath, entry.from) };
  });

  const listedEntries = rootFirst(relative, (entry) => entry.path);
  const changed = new Set(listedEntries.map((entry) => entry.path));

  const listedSubmodules = rootFirst(
    submodulePaths.map((path) => rootRelative(rootPath, path)),
    (path) => path,
  ).filter((path) => !changed.has(path));

  const keptEntries = listedEntries.slice(0, limit);

  const keptSubmodules = listedSubmodules.slice(
    0,
    Math.max(0, limit - keptEntries.length),
  );

  return {
    entries: keptEntries,
    submodules: keptSubmodules,
    omitted:
      listedEntries.length +
      listedSubmodules.length -
      keptEntries.length -
      keptSubmodules.length,
  };
}
