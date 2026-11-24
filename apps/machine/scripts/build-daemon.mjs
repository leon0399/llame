#!/usr/bin/env node
// Builds the Rust daemon and copies it to dist/<target>/llame-machine, the
// path the API and its tests resolve: the static musl target of this host's
// architecture. `--release-targets` builds every
// shipped target instead of the host's.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, renameSync } from "node:fs";
import { arch } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const SHIPPED = ["x86_64-unknown-linux-musl", "aarch64-unknown-linux-musl"];

/** The shipped static target for this host's architecture. */
function hostTarget() {
  return `${arch() === "arm64" ? "aarch64" : "x86_64"}-unknown-linux-musl`;
}

/** `rust-toolchain.toml` pins the toolchain and its musl targets, which only
 *  `rustup` installs; the Nix dev shell provides it. */
function requireRustup() {
  try {
    execFileSync("rustup", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "Building the Machine daemon needs rustup on PATH; enter the dev shell with `nix develop` or direnv.",
    );
  }
}

function build(target) {
  execFileSync(
    "cargo",
    ["build", "--release", "--locked", "-p", "llame-machine", "--target", target],
    { cwd: repo, stdio: "inherit" },
  );
  const built = join(repo, "target", target, "release", "llame-machine");
  const out = join(app, "dist", target);

  mkdirSync(out, { recursive: true });
  // A running daemon holds the old file open for execution; replace the
  // directory entry instead of writing into it.
  const temp = join(out, `.llame-machine.${process.pid}`);

  copyFileSync(built, temp);
  renameSync(temp, join(out, "llame-machine"));
}

requireRustup();

if (process.argv.includes("--release-targets")) {
  for (const target of SHIPPED) build(target);
} else {
  build(hostTarget());
}
