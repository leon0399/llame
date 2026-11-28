import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { daemonBinary, hostTarget } from "./daemon-binary";

const repositoryRoot = resolve(__dirname, "../../..");

describe("daemonBinary", () => {
  it("finds the repository build of the daemon by default", () => {
    expect(daemonBinary({})).toBe(
      resolve(
        repositoryRoot,
        "apps/machine/dist",
        hostTarget(),
        "llame-machine",
      ),
    );
  });

  it("uses the configured binary directory", () => {
    expect(daemonBinary({ LLAME_MACHINE_BIN_DIR: "/opt/llame/bin" })).toBe(
      resolve("/opt/llame/bin", hostTarget(), "llame-machine"),
    );
  });
});
