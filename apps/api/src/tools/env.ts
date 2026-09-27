/** Alpha host bash cwd boundary (`BASH_WORKING_DIRECTORY` or process cwd). */
export function bashWorkingDirectory(): string {
  const fromEnv = process.env.BASH_WORKING_DIRECTORY?.trim();
  if (fromEnv) return fromEnv;
  return process.cwd();
}

/** Process environment injection boundary for host-config readers. */
export function processEnvironment(): NodeJS.ProcessEnv {
  return process.env;
}
