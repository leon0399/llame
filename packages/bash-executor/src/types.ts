/** Model-facing command text. The host supplies cwd, env, and policy. */
export type BashCommandInput = {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
};

/** Trusted host context shared with native file tools. Never model-selected. */
export type BashExecutorContext = {
  readonly workingDirectory: string;
  readonly fileToolsWorkingDirectory: string;
  readonly secretBoundary: boolean;
  readonly processIsolation: boolean;
  readonly outputBound: number;
  readonly inputBound: number;
  readonly durationMs: number;
  readonly maxProcesses: number;
};

export type BashCancellation = {
  readonly signal: AbortSignal;
};

export type BashKnownResult = {
  readonly status: "success" | "error";
  readonly operation: "bash";
  /** Managed executor only; direct host bash is not part of this contract. */
  readonly executor: "managed";
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
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
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
};

export type BashUnavailableResult = {
  readonly status: "error";
  readonly type:
    | "unavailable"
    | "boundary_missing"
    | "workspace_mismatch"
    | "cancelled";
  readonly message: string;
};

export type BashResult =
  | BashKnownResult
  | BashTimedOutResult
  | BashUnknownResult
  | BashUnavailableResult;
