const BASE_ENVIRONMENT_NAMES = [
  "PATH",
  "LANG",
  "HOME",
  "TMPDIR",
  "USER",
  "LOGNAME",
  "TERM",
] as const;

const OPTIONAL_ENVIRONMENT_NAMES = [
  "HOME",
  "TMPDIR",
  "USER",
  "LOGNAME",
] as const;

const baseEnvironmentNames = new Set<string>(BASE_ENVIRONMENT_NAMES);

/** Managed child PATH only — no full process.env passthrough. */
export function managedChildPath(): string {
  return process.env.PATH ?? "/usr/bin:/bin";
}

export function managedEnvironmentCollision(
  additions: Readonly<Record<string, string>> | undefined,
): string | undefined {
  return Object.keys(additions ?? {}).find((key) =>
    baseEnvironmentNames.has(key),
  );
}

/** Build the complete child environment from the declared base and additions. */
export function managedChildEnvironment(
  additions: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const base: Array<readonly [string, string]> = [
    ["PATH", managedChildPath()],
    ["LANG", "C.UTF-8"],
  ];
  for (const name of OPTIONAL_ENVIRONMENT_NAMES) {
    const value = process.env[name];
    if (value !== undefined) base.push([name, value]);
  }
  base.push(["TERM", "dumb"]);
  return Object.fromEntries([...base, ...Object.entries(additions ?? {})]);
}
