// @vitest-environment jsdom

/**
 * The receipt query's gate, which no story can observe: the effective-context
 * inspector mounts with its sheet closed and often without a run id, so the
 * hook must stay idle instead of requesting a receipt for an empty run. The
 * rendered inspector is covered by effective-context-inspector.stories.tsx,
 * and the transport by runs.test.ts (node environment, no DOM).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useRunContextReceipt } from "./runs";
import { jsonResponse, stubFetch } from "../../test-support/fetch-stub";
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

describe("useRunContextReceipt", () => {
  it("stays idle while the inspector is closed", () => {
    const { result } = renderHook(() => useRunContextReceipt("run-1", false), {
      wrapper: wrapperWithClient(newTestQueryClient()),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays idle for an open inspector with no run yet", () => {
    const { result } = renderHook(() => useRunContextReceipt(null, true), {
      wrapper: wrapperWithClient(newTestQueryClient()),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests the receipt under the run's key once open with a run", async () => {
    const receipt = {
      modelId: "system:openai:gpt-5.4-mini",
      effort: null,
      activeAttemptId: null,
      completedAttemptId: "attempt-1",
      state: "completed",
      receipts: [],
      createdAt: "2026-09-16T00:00:00.000Z",
    };
    fetchMock.mockResolvedValue(jsonResponse(receipt));
    const queryClient = newTestQueryClient();

    renderHook(() => useRunContextReceipt("run-1", true), {
      wrapper: wrapperWithClient(queryClient),
    });

    // Literal, not runQueryKeys.contextReceipt(): the factory is duplicated in
    // the Storybook __mocks__ copy, so deriving the expectation from it would
    // let both drift together and still pass.
    await waitFor(() =>
      expect(
        queryClient.getQueryData(["runs", "run-1", "context-receipt"]),
      ).toEqual(receipt),
    );
  });
});
