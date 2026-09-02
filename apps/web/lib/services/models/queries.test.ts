// @vitest-environment jsdom

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import {
  fetchModels,
  hasModelId,
  modelDisplayName,
  modelQueryKeys,
  useModelsQuery,
} from "./queries";
import type { AvailableModel } from "./queries";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";
import {
  newTestQueryClient,
  wrapperWithClient,
} from "../../test-support/query-client";

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const model: AvailableModel = {
  id: "system:openai:gpt-5.4-mini",
  source: "system",
  name: "GPT-5.4 mini",
  contextWindowTokens: 128_000,
};

describe("model query keys", () => {
  // Literal anchor: the wiring test below compares the hook's key against this
  // same factory, so without a literal here any key value ships green.
  it("keeps the resource-path list key", () => {
    expect(modelQueryKeys.all).toEqual(["models"]);
  });
});

describe("fetchModels", () => {
  it("fetches the authenticated models envelope through the generated endpoint", async () => {
    const response = {
      defaultModelId: model.id,
      models: [model],
    };
    fetchMock.mockResolvedValue(jsonResponse(response));

    await expect(fetchModels()).resolves.toEqual(response);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/v1/models");
    expect(request.credentials).toBe("include");
  });
});

describe("useModelsQuery", () => {
  it("surfaces the models envelope under modelQueryKeys.all", async () => {
    const response = { defaultModelId: model.id, models: [model] };
    fetchMock.mockResolvedValue(jsonResponse(response));
    const queryClient = newTestQueryClient();

    const { result, unmount } = renderHook(() => useModelsQuery(), {
      wrapper: wrapperWithClient(queryClient),
    });
    await waitFor(() => expect(result.current.data).toEqual(response));
    expect(queryClient.getQueryData(modelQueryKeys.all)).toEqual(response);

    // staleTime: 60_000 — a remount within the window must not refetch.
    unmount();
    renderHook(() => useModelsQuery(), {
      wrapper: wrapperWithClient(queryClient),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
