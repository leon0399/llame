import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/** The only process-environment boundary. Do not pass this object to tools. */
export function environment(): NodeJS.ProcessEnv {
  return { ...process.env };
}

export function defaultPaths(env: NodeJS.ProcessEnv): { config: string; data: string } {
  const configRoot = xdgRoot(env.XDG_CONFIG_HOME, join(homedir(), '.config'));
  const dataRoot = xdgRoot(env.XDG_DATA_HOME, join(homedir(), '.local', 'share'));
  return {
    config: resolve(env.LLAME_CONFIG || join(configRoot, 'llame', 'cli.json')),
    data: resolve(env.LLAME_DATA_DIR || join(dataRoot, 'llame')),
  };
}

/** A native command has OS-user authority, but does not inherit our secrets. */
export function commandEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = { PATH: env.PATH, LANG: env.LANG || 'C.UTF-8' };
  if (env.SystemRoot) safe.SystemRoot = env.SystemRoot;
  return safe;
}

function xdgRoot(value: string | undefined, fallback: string): string {
  return value && isAbsolute(value) ? value : fallback;
}
