/**
 * Thrown for any operator-config load/parse/validate/interpolation failure.
 * Always fail-loud at boot (D6) — never caught to fall back to a partial or
 * default config. Messages name the config path and the source (env var name
 * / file location); NEVER the resolved value (secrets must not be logged).
 */
export class InstanceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstanceConfigError';
  }
}
