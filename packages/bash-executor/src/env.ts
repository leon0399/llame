/** Managed child PATH only — no full process.env passthrough. */
export function managedChildPath(): string {
  return process.env.PATH ?? "/usr/bin:/bin";
}
