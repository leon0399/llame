/** Operator `ssh` configuration types (ssh-locator D1). */

/**
 * Unresolved top-level `ssh` section (ssh-locator D1). The paths are literal
 * host paths on the hub box, like `machines.ssh`: no `{env:...}`/`{path:...}`
 * interpolation is applied — the loader rejects token syntax before resolving —
 * and relative entries resolve against the configuration file's directory.
 */
export type RawSshConfig = {
  knownHostsFile?: string;
  identityFile?: string;
  configFile?: string;
  /** `ssh` only: the agent `ssh://` may use; the schema refuses it under `machines.ssh`. */
  identityAgent?: string;
};

/**
 * Resolved `ssh` settings: absolute paths with the same defaults and rules as
 * `machines.ssh`. An absent `identityFile`/`configFile` stays absent rather
 * than materializing a default, so the transport applies the worker user's own
 * `~/.ssh/config` at connect time.
 */
export type SshConfig = {
  knownHostsFile: string;
  identityFile?: string;
  configFile?: string;
  /**
   * `SSH_AUTH_SOCK` (read by OpenSSH from the worker's environment) or an
   * absolute socket path. Absent means `IdentityAgent none`; Machines never
   * set it.
   */
  identityAgent?: string;
};
