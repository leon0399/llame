/** The protocol both sides speak; a mismatch ends the session at the handshake. */
export const PROTOCOL_VERSION = 1;

/** Stream 0 carries the handshake, the heartbeat, and session control. Only the
 *  hub opens the numbered streams above it. */
export const CONTROL_STREAM_ID = 0;

/** The bound on one serialized JSON-RPC message (`m`), not on its frame wrapper. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

/** What a frame line may occupy before it is refused unparsed: the message
 *  bound plus the wrapper `{"s":<id>,"m":}` and its newline. */
export const MAX_FRAME_BYTES = MAX_MESSAGE_BYTES + 512;

/** Both sides send `ping` this often and end the session after this many
 *  silent intervals. */
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_MISSES = 3;

/** The concurrent-stream cap of one session; a further request is refused. */
export const MAX_CONCURRENT_STREAMS = 64;

/** The media byte cap, matching the local media path. */
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;

/** The raw size of one `bytes` chunk; base64 encoding grows it by a third,
 *  which stays well inside `MAX_MESSAGE_BYTES`. */
export const BYTES_CHUNK_BYTES = 512 * 1024;

/** The local managed-bash bounds, shared so both sides bound a call alike. */
export const BASH_BOUNDS = {
  outputBound: 32_000,
  inputBound: 8000,
  durationMs: 300_000,
  maxProcesses: 1,
} as const;

/** The daemon's fixed refusal for a path outside its registered roots. It is
 *  identical whether or not the path exists, so it reveals no existence. */
export const PATH_NOT_REGISTERED_MESSAGE =
  "The path is outside every root registered on this Machine.";

export const BUDGET_EXHAUSTED_MESSAGE =
  "The request time budget was already spent when the Machine received it.";

export const INCOMPATIBLE_VERSION_MESSAGE =
  "The hub and the Machine daemon speak different protocol versions.";
