import type { FsGrepParams } from "./types";

/**
 * The search inputs an `fs.grep` page key is bound to. The hub mints a resume
 * key from the same values, so the two sides of one call agree on the key
 * without either trusting the other's spelling of it.
 */
export type FsGrepCursorInputs = Pick<
  FsGrepParams,
  "path" | "globSuffix" | "patterns" | "literal" | "ignoreCase"
>;

/**
 * The key one `fs.grep` cursor is valid against. It is a plain canonical JSON
 * text, not a digest: the daemon compares it byte for byte, and the hub needs
 * no dependency of the engine's to build it.
 */
export function fsGrepCursorKey(inputs: FsGrepCursorInputs): string {
  return JSON.stringify([
    inputs.path,
    inputs.globSuffix ?? null,
    inputs.patterns,
    inputs.literal,
    inputs.ignoreCase,
  ]);
}
