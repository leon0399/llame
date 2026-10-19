import { describe, expect, it } from "vitest";

import { machineNameFromRoot, machinePathFromRoot } from "./locator";

describe("machineNameFromRoot", () => {
  it("reads the Machine from a locator root", () => {
    expect(machineNameFromRoot("machine://devl/home/leo/projects")).toBe(
      "devl",
    );
    expect(machineNameFromRoot("machine://devl/")).toBe("devl");
    expect(machineNameFromRoot("machine://devl")).toBe("devl");
  });

  it("accepts the scheme in any case, as the locator grammar does", () => {
    expect(machineNameFromRoot("MACHINE://devl/tmp")).toBe("devl");
  });

  it("leaves local roots and non-Machines alone", () => {
    expect(
      machineNameFromRoot("/home/operator/projects/llame"),
    ).toBeUndefined();
    expect(
      machineNameFromRoot("file:///home/operator/projects"),
    ).toBeUndefined();
    expect(machineNameFromRoot("machine://")).toBeUndefined();
    expect(machineNameFromRoot("machine:///home/leo")).toBeUndefined();
  });

  it("refuses a name the operator could not have configured", () => {
    expect(machineNameFromRoot("machine://dev_l/tmp")).toBeUndefined();
    expect(
      machineNameFromRoot(`machine://${"a".repeat(64)}/tmp`),
    ).toBeUndefined();
  });
});

describe("machinePathFromRoot", () => {
  it("gives the path a shell on the Machine would take", () => {
    expect(machinePathFromRoot("machine://devl/home/leo/projects")).toBe(
      "/home/leo/projects",
    );
    expect(machinePathFromRoot("machine://devl")).toBe("/");
    expect(machinePathFromRoot("machine://devl/")).toBe("/");
  });

  it("decodes the locator's one layer of escapes", () => {
    expect(machinePathFromRoot("machine://devl/tmp/50%25%20off%23a")).toBe(
      "/tmp/50% off#a",
    );
  });

  it("keeps a malformed escape as written", () => {
    expect(machinePathFromRoot("machine://devl/tmp/%zz")).toBe("/tmp/%zz");
  });

  it("is undefined for a local root", () => {
    expect(machinePathFromRoot("/home/operator/projects")).toBeUndefined();
  });
});
