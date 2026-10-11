import { describe, expect, it } from "vitest";

import type { ModelsResponse } from "@/lib/services/models/queries";
import type { PermissionModesResponse } from "@/lib/services/permission-modes/queries";

import {
  resolveLastTurnModelEffort,
  resolveRestoredPermissionMode,
} from "./use-chat-engine";

describe("resolveLastTurnModelEffort", () => {
  const data: ModelsResponse = {
    defaultModelId: "model:default",
    models: [
      {
        id: "model:default",
        source: "system",
        name: "Default",
        contextWindowTokens: 400_000,
      },
      {
        id: "model:recorded",
        source: "system",
        name: "Recorded",
        contextWindowTokens: 200_000,
      },
    ],
  };

  it("restores the recorded model when it is still in the catalog", () => {
    const turn = {
      modelId: "model:recorded" as const,
      effort: undefined,
      permissionMode: "bypass" as const,
    };
    expect(resolveLastTurnModelEffort(data, turn)).toEqual({
      modelId: "model:recorded",
      effort: undefined,
    });
  });

  it("falls back to the default model when the recorded one is unavailable", () => {
    const turn = {
      modelId: "model:retired" as const,
      effort: undefined,
      permissionMode: "bypass" as const,
    };
    expect(resolveLastTurnModelEffort(data, turn)).toEqual({
      modelId: "model:default",
      effort: undefined,
    });
  });
});

describe("resolveRestoredPermissionMode", () => {
  const turn = {
    modelId: "system:openai:gpt-5.4-mini" as const,
    effort: undefined,
    permissionMode: "bypass" as const,
  };

  it("restores bypass only when the operator still lists it", () => {
    const modes: PermissionModesResponse["modes"] = [
      { value: "default" },
      { value: "bypass" },
    ];
    expect(resolveRestoredPermissionMode(modes, turn)).toBe("bypass");
  });

  it("falls back to default when the last turn's bypass is withdrawn", () => {
    const modes: PermissionModesResponse["modes"] = [{ value: "default" }];
    expect(resolveRestoredPermissionMode(modes, turn)).toBe("default");
  });

  it("treats a missing listing as withdrawn rather than restoring bypass", () => {
    expect(resolveRestoredPermissionMode([], turn)).toBe("default");
  });
});
