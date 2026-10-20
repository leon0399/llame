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
};
