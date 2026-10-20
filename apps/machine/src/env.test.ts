import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { machineConfigDir, rootsFileFor } from "./env";

const original = {
  override: process.env["LLAME_MACHINE_CONFIG_DIR"],
  xdg: process.env["XDG_CONFIG_HOME"],
};

afterEach(() => {
  if (original.override === undefined)
    delete process.env["LLAME_MACHINE_CONFIG_DIR"];
  else process.env["LLAME_MACHINE_CONFIG_DIR"] = original.override;
  if (original.xdg === undefined) delete process.env["XDG_CONFIG_HOME"];
  else process.env["XDG_CONFIG_HOME"] = original.xdg;
});

describe("machine configuration directory", () => {
  it("prefers the explicit override, then XDG, then the home default", () => {
    process.env["LLAME_MACHINE_CONFIG_DIR"] = "/tmp/llame-machine-config";
    process.env["XDG_CONFIG_HOME"] = "/tmp/xdg";
    expect(machineConfigDir()).toBe("/tmp/llame-machine-config");
    delete process.env["LLAME_MACHINE_CONFIG_DIR"];
    expect(machineConfigDir()).toBe("/tmp/xdg/llame-machine");
    delete process.env["XDG_CONFIG_HOME"];
    expect(machineConfigDir()).toBe(
      join(homedir(), ".config", "llame-machine"),
    );
  });

  it("ignores an empty override", () => {
    process.env["LLAME_MACHINE_CONFIG_DIR"] = "";
    delete process.env["XDG_CONFIG_HOME"];
    expect(machineConfigDir()).toBe(
      join(homedir(), ".config", "llame-machine"),
    );
  });

  it("places the roots file in the configuration directory", () => {
    expect(rootsFileFor("/etc/llame-machine")).toBe(
      "/etc/llame-machine/roots.json",
    );
  });
});
