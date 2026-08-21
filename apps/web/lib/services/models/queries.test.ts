import { afterEach, describe, expect, it, vi } from "vitest";

const listModels = vi.hoisted(() => vi.fn());
const authenticatedFetch = vi.hoisted(() => vi.fn());
const createAuthenticatedBrowserFetch = vi.hoisted(() => vi.fn());
const useQuery = vi.hoisted(() => vi.fn());

vi.mock("../../api/generated/models/models", () => ({ listModels }));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch,
}));
vi.mock("@tanstack/react-query", () => ({ useQuery }));

import {
  fetchModels,
  hasModelId,
  modelDisplayName,
  modelQueryKeys,
  useModelsQuery,
} from "./queries";
import type { AvailableModel } from "./queries";

createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);

afterEach(() => {
  vi.clearAllMocks();
  createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);
});

const model: AvailableModel = {
  id: "system:openai:gpt-5.4-mini",
  source: "system",
  name: "GPT-5.4 mini",
  contextWindowTokens: 128_000,
};

describe("fetchModels", () => {
  it("fetches the authenticated models envelope through the generated endpoint", async () => {
    const response = {
      defaultModelId: model.id,
      models: [model],
    };
    listModels.mockResolvedValue(response);

    await expect(fetchModels()).resolves.toEqual(response);

    expect(listModels).toHaveBeenCalledWith(undefined, authenticatedFetch);
    expect(createAuthenticatedBrowserFetch).toHaveBeenCalledWith(
      globalThis.fetch,
    );
  });
});

describe("useModelsQuery", () => {
  it("preserves the model query key and one-minute stale time", () => {
    useModelsQuery();

    expect(useQuery).toHaveBeenCalledWith({
      queryKey: modelQueryKeys.all,
      queryFn: fetchModels,
      staleTime: 60_000,
    });
  });
});

describe("model helpers", () => {
  it("uses a loaded model name when available", () => {
    expect(modelDisplayName(model.id, [model])).toBe("GPT-5.4 mini");
  });

  it("falls back to the opaque id without parsing provider-like prefixes", () => {
    expect(modelDisplayName("openrouter:openai:o3-pro", [])).toBe(
      "openrouter:openai:o3-pro",
    );
  });

  it("reports whether an opaque model id is in the loaded catalog", () => {
    expect(hasModelId([model], model.id)).toBe(true);
    expect(hasModelId([model], "system:openai:missing")).toBe(false);
    expect(hasModelId([model], undefined)).toBe(false);
  });
});
