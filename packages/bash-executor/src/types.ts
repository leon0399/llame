/** Model-facing command text plus per-call cwd and additive environment. */
export type BashCommandInput = {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
};

/** Trusted host context. Never model-selected. */
export type BashExecutorContext = {
  readonly workingDirectory: string;
  readonly secretBoundary: boolean;
  readonly processIsolation: boolean;
  /** The per-stream bound in UTF-16 code units; a Machine keeps this one. */
  readonly outputBound?: number;
  /**
   * The per-stream bound in UTF-8 bytes. The hub sets it, because its bound is
   * `tools.artifacts.maxBytes` and a spilled part is stored at that size
   * (tool-result-artifacts D4). When present it replaces {@link outputBound}.
   */
  readonly outputBoundBytes?: number;
  readonly inputBound: number;
  readonly durationMs: number;
  readonly maxProcesses: number;
};

export type BashCancellation = {
  readonly signal: AbortSignal;
};

/** One flag for each captured stream. */
export type StreamFlags = {
  readonly stdout: boolean;
  readonly stderr: boolean;
};

export type BashKnownResult = {
  readonly status: "success" | "error";
  readonly exitCode: number;
  readonly stdout: string;
  /** Present when a natural signal, rather than an exit code, ended the child. */
  readonly signal?: string;
  readonly stderr: string;
  readonly truncated: boolean;
  /** Which streams the cut touched; `truncated` is their union. */
  readonly truncatedStreams?: StreamFlags;
  /** Spawn to settlement, as the producer measured it (bash-execution
   *  "Command results are bounded and explicit"). */
  readonly wallTimeMs?: number;
};

export type BashUnknownResult = {
  readonly status: "error";
  readonly type: "outcome_unknown";
  readonly attemptId: string;
  readonly message: string;
};

export type BashTimedOutResult = {
  readonly status: "error";
  readonly type: "timed_out";
  /** The deadline the command was stopped at; never a measurement. */
  readonly durationMs: number;
  /** Spawn to stop as the producer measured it, absent when none started. */
  readonly wallTimeMs?: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly truncatedStreams?: StreamFlags;
};

export type BashUnavailableResult = {
  readonly status: "error";
  readonly type: "unavailable" | "boundary_missing" | "cancelled";
  readonly message: string;
};

export type BashResult =
  | BashKnownResult
  | BashTimedOutResult
  | BashUnknownResult
  | BashUnavailableResult;

/** Why the caller stops a managed command: the registry maps each to a state. */
export type ManagedStopCause =
  | "run"
  | "lifetime"
  | "owner"
  | "assistant"
  | "worker";

/** The output a command has produced so far, bounded and redacted. */
export type ManagedOutput = {
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly truncatedStreams: StreamFlags;
};

/**
 * What `stop` returns: whether the process group was proved empty, and the
 * captured streams. It is a type of the handle, not a member of `BashResult`.
 */
export type ManagedStopResult = ManagedOutput & {
  readonly proved: boolean;
};

/** A started command whose deadline and cancellation the caller owns. */
export type ManagedBashHandle = {
  readonly pid: number;
  /** Settles when the command ends, by itself or through `stop`. */
  readonly settled: Promise<BashResult>;
  snapshot(): ManagedOutput;
  /** Captured-byte activity; no polling or idle timer is needed by the caller. */
  onOutput(listener: (bytes: number) => void): () => void;
  stop(cause: ManagedStopCause): Promise<ManagedStopResult>;
};
