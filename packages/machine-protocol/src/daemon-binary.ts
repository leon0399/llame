import { arch } from "node:os";
import { join, resolve } from "node:path";

/** The static target `apps/machine` builds for this host's architecture. */
export function hostTarget(): string {
  return `${arch() === "arm64" ? "aarch64" : "x86_64"}-unknown-linux-musl`;
}

/**
 * Where the repository's daemon build lives:
 * `apps/machine/dist/<target>/llame-machine`. `LLAME_MACHINE_BIN_DIR`
 * replaces `apps/machine/dist`, which is what a container mounts.
 */
export function daemonBinary(target: string = hostTarget()): string {
  const dir =
    process.env["LLAME_MACHINE_BIN_DIR"] ??
    resolve(__dirname, "../../../apps/machine/dist");

  return join(dir, target, "llame-machine");
}
