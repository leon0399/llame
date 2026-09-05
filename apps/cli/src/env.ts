import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** The only process-environment boundary. Do not pass this object to tools. */
export function environment(): NodeJS.ProcessEnv {
  return { ...process.env };
}

export function defaultPaths(env: NodeJS.ProcessEnv): { config: string; data: string } {
  const configRoot = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const dataRoot = env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
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
