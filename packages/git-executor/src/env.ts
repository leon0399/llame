/**
 * The fixed environment of every git process this package starts.
 *
 * A git call inherits nothing from the daemon's or the hub's process: an
 * exported `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, or `GIT_CONFIG_*`
 * would redirect the call at a repository the caller never named, and a
 * credential helper or an editor would turn a read-only inspection into an
 * interactive prompt. Only the three names git needs to find itself and its
 * per-user configuration are inherited, and the three fixed values disable
 * prompting, pin the message language, and keep a read from taking optional
 * locks. This is the package's only `process.env` read.
 */

const FIXED_ENVIRONMENT = {
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  GIT_OPTIONAL_LOCKS: "0",
} as const;

const INHERITED_ENVIRONMENT_NAMES = ["PATH", "HOME", "TMPDIR"] as const;

export function gitEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const inherited = INHERITED_ENVIRONMENT_NAMES.flatMap((name) => {
    const value = source[name];
    return value === undefined ? [] : [[name, value] as const];
  });
  return Object.fromEntries([
    ...Object.entries(FIXED_ENVIRONMENT),
    ...inherited,
  ]);
}
