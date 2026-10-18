import { describe, expect, it } from "vitest";

import { machineNameFromRoot } from "./locator";

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
