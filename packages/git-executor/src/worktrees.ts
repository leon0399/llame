import {
  absoluteGitPath,
  DEFAULT_GIT_TIMEOUT_MS,
  invalidInput,
  processFailure,
  withGit,
  type GitCallOptions,
} from "./invocation";
import type {
  GitFailure,
  GitWorktreeAddResult,
  GitWorktreeEntry,
  GitWorktreeListResult,
  GitWorktreeRemoveResult,
} from "@workspace/machine-protocol";

/*
 * `git.worktreeAdd`, `git.worktreeList`, and `git.worktreeRemove`: the three
 * worktree operations, argv only, under the same fixed environment and hooks
 * directory as `git.inspect`.
 *
 * A caller value that could be read as an option never reaches git: a branch
 * and a base ref that start with `-` are refused here, every path must be
 * absolute, and the remaining values follow `--end-of-options`. The add is
 * unforced and untracked (`--no-track`), so a created
 * branch never inherits the source branch's upstream, and the removal is never
 * forced: git itself refuses a dirty or unregistered directory.
 */

/** How long one worktree creation may take: a checkout writes every file. */
export const WORKTREE_ADD_TIMEOUT_MS = 120_000;

export type WorktreeAddInput = {
  /** The working tree the new branch belongs to. */
  readonly source: string;
  readonly branch: string;
  /** The commit-ish the branch starts from; absent means the source's HEAD. */
  readonly baseRef?: string;
  /** Where the new working tree goes; it must not exist yet. */
  readonly directory: string;
};

/** Characters git forbids anywhere in a ref name, plus whitespace. Control
 *  bytes are refused deliberately: a ref reaches git as one argv element, and a
 *  newline in one is never a name a caller meant. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_REF_CHARACTERS = /[\s~^:?*[\\\u0000-\u001f\u007f]/u;

/** Whitespace and control bytes, the bytes no name or revision a caller meant
 *  holds. A base ref is a commit-ish rather than a name, so it is held to this
 *  bound only: revision operators such as `~` and `^` are its syntax. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_BYTES = /[\s\u0000-\u001f\u007f]/u;

/**
 * The ref-name rules that keep a caller value from becoming an option or an
 * ambiguous revision: no leading `-`, no whitespace or ref punctuation, no
 * empty, `.`-leading, or `.lock` segment, and no `..` or `@{` sequence.
 */
function branchName(
  value: string,
): { readonly name: string } | { readonly message: string } {
  if (value === "") return { message: "A branch name must not be empty." };
  if (value.startsWith("-"))
    return { message: "A branch name must not start with `-`." };
  if (FORBIDDEN_REF_CHARACTERS.test(value))
    return {
      message: "A branch name must not hold whitespace or ref punctuation.",
    };
  if (value.includes("..") || value.includes("@{"))
    return { message: "A branch name must not hold `..` or `@{`." };
  if (value.endsWith("/") || value.endsWith(".") || value.endsWith(".lock"))
    return {
      message: "A branch name must not end with `/`, `.`, or `.lock`.",
    };
  if (
    value
      .split("/")
      .some((segment) => segment === "" || segment.startsWith("."))
  )
    return {
      message: "A branch name must not hold an empty or dot-leading segment.",
    };
  return { name: value };
}

/** The base commit-ish. It follows the directory on the command line, and is
 *  still refused when it looks like an option. The value is a revision, not a
 *  name: `HEAD~1`, `main^`, and `HEAD@{1}` are commit-ishes a caller may mean,
 *  so only empty, option-like, and whitespace or control-byte values are
 *  refused here. */
function baseReference(
  value: string,
): { readonly ref: string } | { readonly message: string } {
  if (value === "") return { message: "A base ref must not be empty." };
  if (value.startsWith("-"))
    return { message: "A base ref must not start with `-`." };
  if (FORBIDDEN_BYTES.test(value))
    return { message: "A base ref must not hold whitespace or control bytes." };
  return { ref: value };
}

function branchOfRef(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

/**
 * Parse `git worktree list --porcelain -z`: one record per field, NUL
 * terminated, with an extra NUL between entries. `-z` keeps a path holding a
 * newline in one record instead of splitting it across lines.
 */
export function parseWorktreeRecords(
  porcelain: string,
): Array<GitWorktreeEntry> {
  const entries: Array<GitWorktreeEntry> = [];
  let draft: GitWorktreeEntry | undefined;
  for (const record of porcelain.split("\0")) {
    if (record === "") continue;
    if (record.startsWith("worktree ")) {
      if (draft !== undefined) entries.push(draft);
      draft = {
        path: record.slice("worktree ".length),
        branch: null,
        head: null,
        locked: false,
        prunable: false,
      };
      continue;
    }
    if (draft === undefined) continue;
    if (record.startsWith("HEAD "))
      draft = { ...draft, head: record.slice("HEAD ".length) };
    else if (record.startsWith("branch "))
      draft = { ...draft, branch: branchOfRef(record.slice("branch ".length)) };
    else if (record === "locked" || record.startsWith("locked "))
      draft = { ...draft, locked: true };
    else if (record === "prunable" || record.startsWith("prunable "))
      draft = { ...draft, prunable: true };
  }
  if (draft !== undefined) entries.push(draft);
  return entries;
}

/** One add's caller values, once each is a value git may receive. */
function readAddInput(input: WorktreeAddInput):
  | {
      readonly source: string;
      readonly directory: string;
      readonly branch: string;
      readonly baseRef?: string;
    }
  | GitFailure {
  const source = absoluteGitPath(input.source);
  if ("status" in source) return source;
  const directory = absoluteGitPath(input.directory);
  if ("status" in directory) return directory;
  const branch = branchName(input.branch);
  if (!("name" in branch)) return invalidInput(branch.message);
  const base =
    input.baseRef === undefined ? undefined : baseReference(input.baseRef);
  if (base !== undefined && !("ref" in base)) return invalidInput(base.message);
  return {
    source: source.path,
    directory: directory.path,
    branch: branch.name,
    baseRef: base?.ref,
  };
}

export async function addWorktree(
  input: WorktreeAddInput,
  options: GitCallOptions = {},
): Promise<GitWorktreeAddResult> {
  const values = readAddInput(input);
  if ("status" in values) return values;

  return withGit(
    values.source,
    {
      timeoutMs: options.timeoutMs ?? WORKTREE_ADD_TIMEOUT_MS,
      signal: options.signal,
    },
    async (git) => {
      const added = await git([
        "worktree",
        "add",
        "--no-track",
        "-b",
        values.branch,
        "--end-of-options",
        values.directory,
        ...(values.baseRef === undefined ? [] : [values.baseRef]),
      ]);
      if (added.status !== "ok") return processFailure(added);
      // The new worktree's HEAD, read in place: the source's HEAD may have
      // moved after the branch was created, so it cannot answer this.
      const head = await git(["-C", values.directory, "rev-parse", "HEAD"]);
      if (head.status !== "ok") return processFailure(head);
      return {
        status: "ok",
        path: values.directory,
        branch: values.branch,
        head: head.stdout.trim(),
      };
    },
  );
}

export async function listWorktrees(
  source: { readonly path: string },
  options: GitCallOptions = {},
): Promise<GitWorktreeListResult> {
  const path = absoluteGitPath(source.path);
  if ("status" in path) return path;
  return withGit(
    path.path,
    {
      timeoutMs: options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
      signal: options.signal,
    },
    async (git) => {
      const listed = await git(["worktree", "list", "--porcelain", "-z"]);
      if (listed.status !== "ok") return processFailure(listed);
      return {
        status: "ok",
        worktrees: parseWorktreeRecords(listed.stdout),
      };
    },
  );
}

export async function removeWorktree(
  target: { readonly path: string },
  options: GitCallOptions = {},
): Promise<GitWorktreeRemoveResult> {
  const path = absoluteGitPath(target.path);
  if ("status" in path) return path;
  return withGit(
    path.path,
    {
      timeoutMs: options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
      signal: options.signal,
    },
    async (git) => {
      const removed = await git([
        "worktree",
        "remove",
        "--end-of-options",
        path.path,
      ]);
      return removed.status === "ok"
        ? { status: "ok" }
        : processFailure(removed);
    },
  );
}
