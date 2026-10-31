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
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
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
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
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
