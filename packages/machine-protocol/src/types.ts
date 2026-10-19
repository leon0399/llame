import type { JsonValue } from "./json-rpc";

/** The relative time budget and the durable identity a request carries. The
 *  daemon measures `budgetMs` from receipt on its own monotonic clock. */
export type RequestEnvelope = {
  readonly runId?: string;
  readonly attemptId?: string;
  readonly toolCallId?: string;
  readonly deliverySeq?: number;
  readonly budgetMs: number;
};

export type HelloParams = {
  readonly protocolVersion: number;
  readonly hubVersion: string;
};

export type HelloResult = {
  readonly protocolVersion: number;
  readonly daemonVersion: string;
  readonly roots: ReadonlyArray<string>;
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

export type NativeMutationResult = {
  readonly status: "success";
  readonly operation: "edit" | "write";
  readonly path: string;
  readonly created?: true;
  readonly replaced?: true;
  readonly diff: string;
  readonly content: string;
  readonly truncated: boolean;
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
  readonly "proc.bash": ProcBashParams;
  readonly "mcp.servers": McpServersParams;
  readonly "mcp.open": McpOpenParams;
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
  readonly "proc.bash": ProcBashResult;
  readonly "mcp.servers": McpServersResult;
  readonly "mcp.open": McpOpenResult;
};

export type MachineMethod = keyof MachineMethodParams;
