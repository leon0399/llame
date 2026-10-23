import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where this Machine keeps its own configuration. `LLAME_MACHINE_CONFIG_DIR`
 * overrides the XDG location for one process, which is what a hub test uses to
 * point the daemon at a fixture directory.
 */
export function machineConfigDir(): string {
  const override = process.env["LLAME_MACHINE_CONFIG_DIR"];
  if (override !== undefined && override.length > 0) return override;
  const xdg = process.env["XDG_CONFIG_HOME"];
  if (xdg !== undefined && xdg.length > 0) return join(xdg, "llame-machine");
  return join(homedir(), ".config", "llame-machine");
}

export function rootsFileFor(configDir: string = machineConfigDir()): string {
  return join(configDir, "roots.json");
}

/**
 * The environment a Workspace's MCP declarations interpolate against: this
 * box's own variables, never the hub's, which is what keeps a hub-resolved
 * secret from reaching the Machine and a Machine-resolved one from reaching
 * the hub. Read at each `mcp.*` call rather than cached, so the answer follows
 * the daemon's own environment.
 */
export function machineEnvironment(): NodeJS.ProcessEnv {
  return process.env;
}

/**
 * The daemon's Sentry identity from this box's environment, or nothing when
 * `SENTRY_DSN` is unset. `SENTRY_RELEASE` is read by the SDK itself.
 */
export function sentryOptions():
  | { readonly dsn: string; readonly environment: string }
  | undefined {
  const dsn = process.env["SENTRY_DSN"];
  if (dsn === undefined || dsn.length === 0) return undefined;
  const environment = process.env["SENTRY_ENVIRONMENT"];
  return {
    dsn,
    environment:
      environment === undefined || environment.length === 0
        ? "local"
        : environment,
  };
}
