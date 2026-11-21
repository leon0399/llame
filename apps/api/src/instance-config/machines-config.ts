/** Operator `machines` configuration types (host-as-machine D3). */

/**
 * Unresolved `machines` section (host-as-machine D3). The `ssh` paths are
 * literal host paths on the hub box, like `tools.promptFiles` and
 * `skills.directories`: no `{env:...}`/`{path:...}` interpolation is applied —
 * the loader rejects token syntax before resolving — and relative entries
 * resolve against the configuration file's directory. `local` and `default`
 * are the exception: each is a Machine name or ONE whole-value `{env:...}`
 * token, resolved once at startup.
 */
export type RawMachinesConfig = {
  ssh?: {
    knownHostsFile?: string;
    identityFile?: string;
    configFile?: string;
  };
  /** The Machine this process hosts: an entry of `hosts`. */
  local?: string;
  /** The Machine an unbound Chat uses: an entry of `hosts` this process can reach. */
  default?: string;
  hosts?: Record<string, MachineHostConfig>;
};

/**
 * One declared Machine. `destination` is the SSH address the hub connects to
 * for it; an entry without one is reachable only by the process whose
 * `machines.local` names it, which holds that Machine in process.
 */
export type MachineHostConfig = { readonly destination?: string };

/**
 * The resolved `machines.ssh` files: absolute paths with the worker user's
 * defaults. An absent `identityFile`/`configFile` stays absent rather than
 * materializing a default, so the session manager applies its own.
 */
export type ResolvedSshFiles = {
  readonly knownHostsFile: string;
  readonly identityFile?: string;
  readonly configFile?: string;
};

/**
 * Resolved operator-owned Machine settings (remote-machines D12,
 * host-as-machine D3): `ssh` paths are absolute (relative resolved against the
 * configuration file's directory, a leading `~/` against the operator process
 * home). `ssh` is absent when nothing needs SSH — no entry declares a
 * `destination` and the operator wrote no `ssh` block. `hosts` is always
 * present when the section is, possibly empty.
 */
export type MachinesConfig = {
  readonly ssh?: ResolvedSshFiles;
  /** `machines.local`: the Machine this process hosts, reached through its daemon. */
  readonly local?: string;
  /** `machines.default`: the Machine that serves an unbound Chat. */
  readonly default?: string;
  readonly hosts: Readonly<Record<string, MachineHostConfig>>;
};
