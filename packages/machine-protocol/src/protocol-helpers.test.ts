import { describe, expect, it } from "vitest";

import { daemonBinary, hostTarget } from "./daemon-binary";
import { MACHINE_ERROR_CODES, MachineProtocolError, isMachineErrorCode } from "./errors";
import { isIntegerValue, isSerializableRecord, isStringValue } from "./values";

describe("protocol error vocabulary", () => {
  it("recognises only daemon error codes", () => {
    expect(MACHINE_ERROR_CODES).toContain("machine_identity_mismatch");
    expect(isMachineErrorCode("path_not_registered")).toBe(true);
    expect(isMachineErrorCode("not_a_machine_error")).toBe(false);
  });

  it("preserves the structured refusal data", () => {
    const error = new MachineProtocolError("invalid_argument", "bad path", {
      path: "/outside",
    });

    expect(error).toMatchObject({
      name: "MachineProtocolError",
      code: "invalid_argument",
      message: "bad path",
      data: { path: "/outside" },
    });
    expect(error).toBeInstanceOf(Error);
  });
});

describe("serializable value guards", () => {
  it("accepts JSON records but not arrays or null", () => {
    expect(isSerializableRecord({ path: "/root", optional: undefined })).toBe(true);
    expect(isSerializableRecord([])).toBe(false);
    expect(isSerializableRecord(null)).toBe(false);
    expect(isSerializableRecord("value")).toBe(false);
  });

  it("distinguishes strings and integers from other JSON values", () => {
    expect(isStringValue("text")).toBe(true);
    expect(isStringValue(1)).toBe(false);
    expect(isIntegerValue(0)).toBe(true);
    expect(isIntegerValue(1.5)).toBe(false);
    expect(isIntegerValue(Number.NaN)).toBe(false);
    expect(isIntegerValue("1")).toBe(false);
  });
});

describe("daemon binary selection", () => {
  it("selects the Linux x64 static target", () => {
    if (process.platform !== "linux" || process.arch !== "x64") return;

    expect(hostTarget()).toBe("x86_64-unknown-linux-musl");
  });

  it("honours an explicit binary directory", () => {
    if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch))
      return;

    expect(daemonBinary({ LLAME_MACHINE_BIN_DIR: "/opt/llame" })).toBe(
      `/opt/llame/${hostTarget()}/llame-machine`,
    );
  });
});
