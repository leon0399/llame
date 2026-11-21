import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const BUILD_ID_LENGTH = 12;

/**
 * The content hash of the bundle this process runs. A Machine that keeps the
 * same instance id but changes build is how the hub sees an in-place upgrade.
 */
export function buildIdOf(script: string | undefined): string {
  if (script === undefined) return "unknown";

  try {
    return createHash("sha256")
      .update(readFileSync(script))
      .digest("hex")
      .slice(0, BUILD_ID_LENGTH);
  } catch {
    return "unknown";
  }
}

let memoized: string | undefined;

/** `buildIdOf` for the running script, read once per process. */
export function currentBuildId(): string {
  memoized ??= buildIdOf(process.argv[1]);

  return memoized;
}
