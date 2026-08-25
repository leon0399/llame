import { describe, expect, it } from "vitest";

import { effortDisplayLabel, effortDisplayLabelForModel } from "./effort";

const LEVELS = [
  { value: "none" },
  { value: "xhigh", label: "Extra High" },
] as const;

describe("effortDisplayLabel", () => {
  it("returns the label when present", () => {
    expect(effortDisplayLabel(LEVELS, "xhigh")).toBe("Extra High");
  });

  it("falls back to the value when unlabeled", () => {
    expect(effortDisplayLabel(LEVELS, "none")).toBe("none");
  });

  it("falls back to the value when levels are missing or unknown", () => {
    expect(effortDisplayLabel(undefined, "max")).toBe("max");
    expect(effortDisplayLabel(LEVELS, "max")).toBe("max");
  });
});

describe("effortDisplayLabelForModel", () => {
  const models = [
    {
      id: "system:openai:reasoner",
      source: "system" as const,
      contextWindowTokens: 1000,
      reasoning: {
        effortLevels: [...LEVELS],
        defaultEffort: "none",
        cacheInvalidatedByEffortChange: false,
      },
    },
  ];

  it("resolves via modelId against the live catalog", () => {
    expect(
      effortDisplayLabelForModel(models, "system:openai:reasoner", "xhigh"),
    ).toBe("Extra High");
  });

  it("falls back when the model or value is unknown", () => {
    expect(effortDisplayLabelForModel(models, "ghost", "xhigh")).toBe("xhigh");
    expect(
      effortDisplayLabelForModel(models, "system:openai:reasoner", "gone"),
    ).toBe("gone");
  });
});
