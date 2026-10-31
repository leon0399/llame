import type { JsonValue } from "./json-rpc";

/** The hub's active trace, in the `sentry-trace` and `baggage` header
 *  formats, so the daemon's work joins the trace that asked for it. */
export type RequestTrace = {
  readonly sentryTrace: string;
  readonly baggage?: string;
};

/** The relative time budget and the durable identity a request carries. The
 *  daemon measures `budgetMs` from receipt on its own monotonic clock. */
export type RequestEnvelope = {
  readonly runId?: string;
  readonly attemptId?: string;
  readonly toolCallId?: string;
  readonly deliverySeq?: number;
  readonly budgetMs: number;
  readonly trace?: RequestTrace;
};

export type HelloParams = {
  readonly protocolVersion: number;
  readonly hubVersion: string;
};

export type HelloResult = {
  readonly protocolVersion: number;
  readonly daemonVersion: string;
  readonly roots: ReadonlyArray<string>;
  /** The git methods this daemon answers; absent on a daemon that predates
   *  them, which is how the hub tells that it needs an update. */
  readonly methods?: ReadonlyArray<string>;
};

/** The handshake refusal: both versions travel so the hub can report them. */
export type IncompatibleVersionData = {
  readonly code: "incompatible_version";
  readonly hubProtocolVersion: number;
  readonly daemonProtocolVersion: number;
};

export type RootsListParams = { readonly envelope: RequestEnvelope };
export type RootsListResult = { readonly roots: ReadonlyArray<string> };

export type FsStatKind = "file" | "directory" | "other" | "missing";
export type FsStatParams = {
  readonly envelope: RequestEnvelope;
  readonly path: string;
};
export type FsStatResult = {
  readonly kind: FsStatKind;
  readonly size?: number;
  /** Canonical path inside the roots; the hub renders its locator. */
  readonly realPath?: string;
  readonly isLink: boolean;
};

export type FsListEntryKind = "file" | "directory" | "link" | "other";
export type FsListEntry = {
  readonly name: string;
  readonly kind: FsListEntryKind;
};
export type FsListParams = {
  readonly envelope: RequestEnvelope;
  readonly path: string;
};
export type FsListResult =
  | {
      readonly entries: ReadonlyArray<FsListEntry>;
      /** Every entry the directory holds, of which `entries` may be a head. */
      readonly totalCount: number;
      readonly truncated: boolean;
    }
  | NativeFailureResult;

/** What the hub supplies so every rendered path can be a locator; the daemon
 *  never invents the `machine://` spelling itself. */
export type NativeDisplayOptions = {
  readonly displayPrefix: string;
  readonly selector?: string;
  readonly reserveCodeUnits?: number;
};

export type FsReadParams = {
  readonly envelope: RequestEnvelope;
  readonly path: string;
  readonly options: NativeDisplayOptions;
};

/** The failure vocabulary of `@workspace/native-file-tools`; a refusal is a
 *  result, never a protocol error. */
export type NativeFailureType =
  | "invalid_path"
  | "invalid_selector"
  | "not_found"
  | "not_regular_file"
  | "invalid_utf8"
  | "invalid_input"
  | "file_exists"
  | "old_text_not_found"
  | "old_text_ambiguous"
  | "outcome_unknown"
  | "executor_unavailable"
  | "directory_too_large"
  | "representation_too_large"
  | "media_too_large"
  | "unsupported_media_type";

export type NativeLineRange = {
  readonly startLine: number;
  readonly endLine: number;
};

export type NativeFailureResult = {
  readonly status: "error";
  readonly type: NativeFailureType;
  readonly message: string;
  readonly count?: number;
};

export type NativeFileReadResult = {
  readonly status: "success";
  readonly kind: "file" | "directory";
  readonly path: string;
  readonly realPath?: string;
  readonly content: string;
  readonly truncated: boolean;
  readonly nextOffset?: number;
  /** The source's line count, when the daemon knows it. Absent on a daemon
   *  that predates the field, on an outline, and past the count bound. */
  readonly lineCount?: number;
  /** Every entry the listed level holds, of which `content` may be a page. */
  readonly entryCount?: number;
  /** The read's representation. Absent on a daemon that predates the field,
   *  and read as `text`. */
  readonly representation?: "text" | "raw" | "outline";
  readonly requestedRange?: NativeLineRange | null;
  readonly shownRange?: NativeLineRange | null;
  readonly requestedRanges?: ReadonlyArray<NativeLineRange>;
  readonly shownRanges?: ReadonlyArray<NativeLineRange>;
};

/** The local media shape, part of the shared read contract. `fs.read` never
 *  produces it: image and PDF bytes travel through `fs.bytes`. */
export type NativeMediaReadResult = {
  readonly status: "success";
  readonly kind: "image" | "pdf";
  readonly mediaType: string;
  readonly path: string;
  readonly realPath?: string;
};

export type FsReadResult =
  | NativeFileReadResult
  | NativeMediaReadResult
  | NativeFailureResult;

export type FsMutateParams = {
  readonly envelope: RequestEnvelope;
  readonly path: string;
  readonly options: NativeDisplayOptions;
  readonly oldText: string;
  readonly newText: string;
};

export type FsWriteParams = {
  readonly envelope: RequestEnvelope;
  readonly path: string;
  readonly options: NativeDisplayOptions;
  readonly content: string;
  readonly replace?: boolean;
};

/** Display-only data for the owner UI: the exact replaced and replacement
 *  text with the post-edit line the region starts at. Never rendered for the
 *  model. Absent on a daemon that predates the field. */
export type NativeMutationDisplay = {
  /** The post-edit line the region starts at, which only the daemon that ran
   *  the edit can compute. */
  readonly startLine: number;
  /** The replaced and replacement text. A daemon answers with the start line
   *  alone: the hub holds both strings in the call and rebuilds them, so a
   *  large replacement crosses one frame once instead of twice. */
  readonly oldText?: string;
  readonly newText?: string;
};

export type NativeMutationResult = {
  readonly status: "success";
  readonly operation: "edit" | "write";
  readonly path: string;
  readonly created?: true;
  readonly replaced?: true;
  readonly replacements?: 1;
  /** The numbered post-edit region of an edit. Absent on a write, and on a
   *  daemon that predates the field. */
  readonly content?: string;
  readonly shownRange?: NativeLineRange | null;
  readonly truncated?: boolean;
  /** The daemon's own bound cut the region. The hub's result cap overwrites
   *  `truncated` but never this field, so a rendering can name a bound cut
   *  without claiming the cap's. Absent on a daemon that predates the field. */
  readonly cut?: boolean;
  /** The written or post-edit source's line count. Absent on a daemon that
   *  predates the field. */
  readonly lineCount?: number;
  /** An edit's `@@ replacement at line N @@` text, which only a daemon that
   *  predates `display` sends. The hub keeps it on the mapped legacy edit
   *  because the owner UI numbers such a part from its header. Never rendered
   *  for the model. */
  readonly diff?: string;
  readonly display?: NativeMutationDisplay;
};

export type FsMutateResult = NativeMutationResult | NativeFailureResult;

export type FsBytesParams = {
  readonly envelope: RequestEnvelope;
  readonly path: string;
};
export type FsBytesChunk = {
  readonly seq: number;
  readonly data: string;
};
export type FsBytesResult =
  | { readonly size: number; readonly mediaType: string }
  | NativeFailureResult;

/** What is left of one call's search bounds when a request reaches a Machine. */
export type FsGrepBudget = {
  readonly files: number;
  readonly entries: number;
  readonly bytes: number;
  readonly deadlineMs: number;
  readonly limit: number;
  readonly pageUnits: number;
};

export type FsGrepParams = {
  readonly envelope: RequestEnvelope;
  /** The absolute literal prefix; the daemon resolves it through its roots. */
  readonly path: string;
  /** The glob text from the first glob segment onward. */
  readonly globSuffix?: string;
  readonly patterns: ReadonlyArray<string>;
  readonly literal: boolean;
  readonly ignoreCase: boolean;
  /** The daemon's own page key, issued for the same search inputs. */
  readonly cursor?: string;
  readonly budget: FsGrepBudget;
};

/** The skips a walk counts, by kind; the same vocabulary as the local walk. */
export type FsGrepWarningKind =
  | "binary"
  | "invalid_utf8"
  | "oversized"
  | "unreadable"
  | "link"
  | "file_bound"
  | "entry_bound"
  | "byte_bound"
  | "deadline";

export type FsGrepWarning = {
  readonly kind: FsGrepWarningKind;
  readonly count: number;
};

export type FsGrepConsumed = {
  readonly files: number;
  readonly entries: number;
  readonly bytes: number;
};

/** One passage named relative to the request's prefix, never by host path. */
export type FsGrepPassage = {
  /** `'/'-separated`, relative to the prefix; empty when the prefix is the file. */
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
  readonly matches: ReadonlyArray<number>;
  readonly truncated?: true;
  /**
   * The passage is its file's twentieth, by the file's own passage order. The
   * hub needs the absolute position: it counts no passages of its own, so a
   * page that starts mid-file would otherwise lose the marker.
   */
  readonly capped?: true;
  /**
   * The page cut this passage at a line boundary, so `endLine` is the last
   * line it emitted rather than the passage's own end. A resume continues the
   * rest of the passage from that line.
   */
  readonly cut?: true;
};

export type FsGrepSuccess = {
  readonly ok: true;
  readonly results: ReadonlyArray<FsGrepPassage>;
  readonly complete: boolean;
  /** The daemon's next page key, opaque to the hub. */
  readonly cursor?: string;
  readonly warnings: ReadonlyArray<FsGrepWarning>;
  readonly consumed: FsGrepConsumed;
};

export type FsGrepResult = FsGrepSuccess | NativeFailureResult;

export type ProcBashParams = {
  readonly envelope: RequestEnvelope;
  readonly command: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
};

/** The managed-executor result, exactly as `@workspace/bash-executor` returns
 *  it; a non-zero exit is this result, not a protocol error. */
export type ProcBashResult =
  | {
      readonly status: "success" | "error";
      readonly operation: "bash";
      readonly executor: "managed";
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
      readonly truncated: boolean;
    }
  | {
      readonly status: "error";
      readonly type: "timed_out";
      readonly durationMs: number;
      readonly stdout: string;
      readonly stderr: string;
      readonly truncated: boolean;
    }
  | {
      readonly status: "error";
      readonly type: "outcome_unknown";
      readonly attemptId: string;
      readonly message: string;
    }
  | {
      readonly status: "error";
      readonly type: "unavailable" | "boundary_missing" | "cancelled";
      readonly message: string;
    };

export type McpTransportKind = "stdio" | "http";
export type McpServerState = "available" | "unavailable";
export type McpServerEntry = {
  readonly name: string;
  /** Absent when the entry never resolved far enough to name its transport:
   *  the Machine read the declaration but, for example, an `{env:…}` token was
   *  unset there, so only `state: "unavailable"` and its diagnostic are known. */
  readonly transport?: McpTransportKind;
  readonly state: McpServerState;
  readonly diagnostic?: string;
};
export type McpServersParams = {
  readonly envelope: RequestEnvelope;
  readonly root: string;
};
export type McpServersResult = {
  readonly servers: ReadonlyArray<McpServerEntry>;
};
export type McpOpenParams = {
  readonly envelope: RequestEnvelope;
  readonly root: string;
  readonly server: string;
};
export type McpOpenResult = {
  readonly protectedValues: ReadonlyArray<string>;
};
export type McpMessageNotification = { readonly message: JsonValue };
export type McpStderrNotification = { readonly text: string };
export type McpProtectedNotification = {
  readonly values: ReadonlyArray<string>;
};
export type McpSetProtocolVersionNotification = { readonly version: string };

/** One configured remote of a repository, as an inspection reports it. */
export type GitRepositoryRemote = {
  readonly name: string;
  readonly url: string;
};

/**
 * A git refusal or failure. `invalid_input` is refused before git starts, and
 * carries the reason; every other type comes from a started process and
 * carries the bounded, redacted standard error. On a Machine, each
 * registered-root prefix in that text is a locator by the time it arrives.
 */
export type GitFailure =
  | {
      readonly status: "error";
      readonly type: "invalid_input";
      readonly message: string;
    }
  | {
      readonly status: "error";
      readonly type: "not_a_repository" | "timed_out" | "git_failed";
      readonly stderr: string;
    };

/** `git.inspect`, exactly as `@workspace/git-executor` returns it: every path
 *  field is a locator on a Machine and an absolute host path locally. */
export type GitInspectParams = {
  readonly envelope: RequestEnvelope;
  readonly path: string;
  readonly options: NativeDisplayOptions;
};
export type GitInspectSuccess = {
  readonly status: "ok";
  readonly toplevel: string;
  readonly commonDir: string;
  readonly linked: boolean;
  readonly mainWorktree: string | null;
  readonly remotes: ReadonlyArray<GitRepositoryRemote>;
  readonly branch: string | null;
  readonly head: string | null;
};
export type GitInspectResult = GitInspectSuccess | GitFailure;

/** `git.status`: the working tree's state and its place against its upstream. */
export type GitStatusParams = {
  readonly envelope: RequestEnvelope;
  readonly path: string;
  readonly options: NativeDisplayOptions;
};
export type GitStatusSuccess = {
  readonly status: "ok";
  readonly dirty: boolean;
  /** Commits the branch is ahead of its upstream; zero without an upstream. */
  readonly ahead: number;
  /** The upstream ref, absent when the branch tracks none. */
  readonly upstream?: string;
  /** `null` on an unborn branch, which has no commit yet. */
  readonly head: string | null;
};
export type GitStatusResult = GitStatusSuccess | GitFailure;

/** `git.worktreeAdd`: a new worktree of `source` on a new branch. */
export type GitWorktreeAddParams = {
  readonly envelope: RequestEnvelope;
  readonly source: string;
  readonly branch: string;
  /** The commit-ish the branch starts from; absent means the source's HEAD. */
  readonly baseRef?: string;
  readonly directory: string;
  readonly options: NativeDisplayOptions;
};
export type GitWorktreeAddSuccess = {
  readonly status: "ok";
  readonly path: string;
  readonly branch: string;
  /** The commit the new worktree's HEAD names. */
  readonly head: string;
};
export type GitWorktreeAddResult = GitWorktreeAddSuccess | GitFailure;

/** One registered worktree of a repository. */
export type GitWorktreeEntry = {
  readonly path: string;
  /** `null` on a detached worktree. */
  readonly branch: string | null;
  readonly head: string | null;
  readonly locked: boolean;
  readonly prunable: boolean;
};

/** `git.worktreeList`: every worktree of `source`, its main tree first. */
export type GitWorktreeListParams = {
  readonly envelope: RequestEnvelope;
  readonly source: string;
  readonly options: NativeDisplayOptions;
};
export type GitWorktreeListResult =
  | {
      readonly status: "ok";
      readonly worktrees: ReadonlyArray<GitWorktreeEntry>;
    }
  | GitFailure;

/** `git.worktreeRemove`: the unforced removal of one registered worktree. */
export type GitWorktreeRemoveParams = {
  readonly envelope: RequestEnvelope;
  readonly path: string;
  readonly options: NativeDisplayOptions;
};
export type GitWorktreeRemoveResult = { readonly status: "ok" } | GitFailure;

/** Every method's params, keyed by its wire name. */
export type MachineMethodParams = {
  readonly hello: HelloParams;
  readonly "roots.list": RootsListParams;
  readonly "fs.stat": FsStatParams;
  readonly "fs.list": FsListParams;
  readonly "fs.read": FsReadParams;
  readonly "fs.edit": FsMutateParams;
  readonly "fs.write": FsWriteParams;
  readonly "fs.bytes": FsBytesParams;
  readonly "fs.grep": FsGrepParams;
  readonly "proc.bash": ProcBashParams;
  readonly "mcp.servers": McpServersParams;
  readonly "mcp.open": McpOpenParams;
  readonly "git.inspect": GitInspectParams;
  readonly "git.worktreeAdd": GitWorktreeAddParams;
  readonly "git.worktreeList": GitWorktreeListParams;
  readonly "git.worktreeRemove": GitWorktreeRemoveParams;
  readonly "git.status": GitStatusParams;
};

/** Every method's result, keyed by the same names. */
export type MachineMethodResults = {
  readonly hello: HelloResult;
  readonly "roots.list": RootsListResult;
  readonly "fs.stat": FsStatResult;
  readonly "fs.list": FsListResult;
  readonly "fs.read": FsReadResult;
  readonly "fs.edit": FsMutateResult;
  readonly "fs.write": FsMutateResult;
  readonly "fs.bytes": FsBytesResult;
  readonly "fs.grep": FsGrepResult;
  readonly "proc.bash": ProcBashResult;
  readonly "mcp.servers": McpServersResult;
  readonly "mcp.open": McpOpenResult;
  readonly "git.inspect": GitInspectResult;
  readonly "git.worktreeAdd": GitWorktreeAddResult;
  readonly "git.worktreeList": GitWorktreeListResult;
  readonly "git.worktreeRemove": GitWorktreeRemoveResult;
  readonly "git.status": GitStatusResult;
};

export type MachineMethod = keyof MachineMethodParams;
