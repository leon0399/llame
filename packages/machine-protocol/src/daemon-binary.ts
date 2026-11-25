import { resolve } from "node:path";
import { processEnvironment } from "./env";

/** Rust daemon target for this host. */
export function hostTarget(): string {
  if (process.platform !== "linux") {
    throw new Error(
      `The Machine daemon has no build target for ${process.platform}.`,
    );
  }

  if (process.arch === "x64") return "x86_64-unknown-linux-musl";

  if (process.arch === "arm64") return "aarch64-unknown-linux-musl";

  throw new Error(
    `The Machine daemon has no build target for ${process.arch}.`,
  );
}

/** Resolve the built daemon, allowing deployments to provide a binary directory. */
export function daemonBinary(
  env: NodeJS.ProcessEnv = processEnvironment(),
): string {
  const configured = env["LLAME_MACHINE_BIN_DIR"];

  // Both src/ and dist/ sit two levels below packages/machine-protocol's parent.
  const directory =
    configured ?? resolve(__dirname, "../../../apps/machine/dist");

  return resolve(directory, hostTarget(), "llame-machine");
}
