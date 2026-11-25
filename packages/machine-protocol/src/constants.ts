export const ROOTS_LIST_METHOD = "roots.list";
export const FS_STAT_METHOD = "fs.stat";
export const FS_LIST_METHOD = "fs.list";
export const FS_GREP_METHOD = "fs.grep";
export const BYTES_NOTIFICATION = "bytes";

export const BYTES_CHUNK_BYTES = 512 * 1024;
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;

export const PATH_NOT_REGISTERED_MESSAGE =
  "The path is outside every root registered on this Machine.";
export const BUDGET_EXHAUSTED_MESSAGE =
  "The request time budget was already spent when the Machine received it.";
export const INCOMPATIBLE_VERSION_MESSAGE =
  "The hub and the Machine daemon speak different protocol versions.";

export const INSTANCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const BUILD_ID_PATTERN = /^(?:[0-9a-f]{12}|unknown)$/u;
export const BUILD_ID_LENGTH = 12;

/** Bounds for the foreground Machine bash tool. */
export const BASH_BOUNDS = {
  outputBound: 32_000,
  inputBound: 8000,
  durationMs: 300_000,
  maxProcesses: 1,
} as const;
