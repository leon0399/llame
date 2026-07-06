import { describe, expect, it } from "vitest";

import { enrichAvailableModels, type AvailableModel } from "./enrich";

const available = (id: string, label: string): AvailableModel => ({
  id,
  label,
  providerType: "openai",
  source: "byok",
  providerAccountId: "acc-1",
});

describe("enrichAvailableModels", () => {
  it("enriches a live BARE id with catalog metadata (the fix)", () => {
    // Live ids are bare ("gpt-4o"); the catalog is prefixed ("openai:gpt-4o").
    // The old exact-id lookup missed this and returned only id+label.
    const [model] = enrichAvailableModels([available("gpt-4o", "GPT-4o BYOK")]);
    expect(model.id).toBe("gpt-4o");
    expect(model.name).toBe("GPT-4o"); // catalog name, not the raw label
    expect(model.description).toBeTruthy(); // catalog description now present
    expect(model.price?.output).toBeGreaterThan(0); // pricing now present
  });

  it("keeps id + label for an unknown/custom model (no catalog entry)", () => {
    const [model] = enrichAvailableModels([
      available("my-local-7b", "My Local 7B"),
    ]);
    expect(model.id).toBe("my-local-7b");
    expect(model.name).toBe("My Local 7B"); // falls back to the label
    expect(model.description).toBeUndefined();
  });
});
