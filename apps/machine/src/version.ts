/**
 * The daemon's own version, reported at the handshake and shown in the hub's
 * Machines list. The bundle is copied onto a Machine without `package.json`,
 * so this is the one place the version is written; keep it in step with the
 * workspace's `package.json`.
 */
export const DAEMON_VERSION = "0.0.1";
