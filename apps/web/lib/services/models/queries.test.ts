import { afterEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: { get },
  buildApiUrl: (path: string) => `http://api${path}`,
}));

import { fetchModels, modelDisplayName } from "./queries";

function jsonResolved<T>(value: T) {
  return { json: () => Promise.resolve(value) };
}

afterEach(() => {
  get.mockReset();
});

describe("fetchModels", () => {
  it("fetches the authenticated models envelope from /api/v1/models", async () => {
    const response = {
      defaultModelId: "system:openai:gpt-5.4-mini",
      models: [
        {
          id: "system:openai:gpt-5.4-mini",
          source: "system",
          name: "GPT-5.4 mini",
          contextWindowTokens: 128_000,
        },
      ],
    };
    get.mockReturnValue(jsonResolved(response));

    await expect(fetchModels()).resolves.toEqual(response);
    expect(get).toHaveBeenCalledWith("http://api/api/v1/models");
  });
});

describe("modelDisplayName", () => {
  it("uses a loaded model name when available", () => {
    expect(
      modelDisplayName("system:openai:gpt-5.4-mini", [
        {
          id: "system:openai:gpt-5.4-mini",
          source: "system",
          name: "GPT-5.4 mini",
          contextWindowTokens: 128_000,
        },
      ]),
    ).toBe("GPT-5.4 mini");
  });

  it("falls back to the opaque id without parsing provider-like prefixes", () => {
    expect(modelDisplayName("openrouter:openai:o3-pro", [])).toBe(
      "openrouter:openai:o3-pro",
    );
  });
});
