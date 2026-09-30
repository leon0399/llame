import { realpath, stat } from "node:fs/promises";

export type HostPathStat =
  | { readonly kind: "missing" }
  | {
      readonly kind: "file" | "directory" | "other";
      readonly size: number;
      readonly canonicalPath: string;
    };

/**
 * Follows symlinks (`fs.stat` + `fs.realpath`). Every error maps to
 * `missing`: the probe decides nothing and reveals nothing.
 */
export async function statHostPath(path: string): Promise<HostPathStat> {
  try {
    const stats = await stat(path);
    const kind = stats.isFile()
      ? "file"
      : stats.isDirectory()
        ? "directory"
        : "other";
    return { kind, size: stats.size, canonicalPath: await realpath(path) };
  } catch {
    return { kind: "missing" };
  }
}
