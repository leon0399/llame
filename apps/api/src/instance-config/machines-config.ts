/** Operator `machines` configuration types (remote-machines D12). */

/**
 * Unresolved `machines` section (remote-machines D12). The `ssh` paths are
 * literal host paths on the hub box, like `tools.promptFiles` and
 * `skills.directories`: no `{env:...}`/`{path:...}` interpolation is applied —
 * the loader rejects token syntax before resolving — and relative entries
 * resolve against the configuration file's directory.
 */
export type RawMachinesConfig = {
  ssh?: {
    knownHostsFile?: string;
    identityFile?: string;
    configFile?: string;
  };
  hosts?: Record<string, MachineHostConfig>;
};

/** One declared Machine: the SSH destination the hub connects to for it. */
export type MachineHostConfig = { destination: string };

/**
 * Resolved operator-owned remote Machine settings (remote-machines D12): `ssh`
 * paths are absolute (relative resolved against the configuration file's
 * directory, a leading `~/` against the operator process home). An absent
 * `identityFile`/`configFile` stays absent rather than materializing a default,
 * so the session manager applies its own. `hosts` is always present when the
 * section is, possibly empty.
 */
export type MachinesConfig = {
  ssh: {
    knownHostsFile: string;
    identityFile?: string;
    configFile?: string;
  };
  hosts: Record<string, MachineHostConfig>;
};
