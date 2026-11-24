// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toast } from "@workspace/ui/components/sonner";

import type { ChatLatestRunResponse } from "@/lib/api/generated/models";
import * as runs from "@/lib/services/chat/runs";
import { modelQueryKeys } from "@/lib/services/models/queries";

import { useNextCandidateSwitch } from "./use-next-candidate";

const waitingRun: ChatLatestRunResponse = {
  kind: "turn",
  id: "11111111-1111-4111-8111-111111111111",
  messageId: "user-1",
  status: "awaiting_quota",
  followUpAction: null,
  selector: "@coding",
  modelId: "system:openai:codex",
  effort: "low",
  permissionMode: "default",
  error: null,
  errorCode: null,
  errorResetsAt: null,
  quotaWait: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useNextCandidateSwitch", () => {
  it("refreshes history and role configuration when the switch is refused", async () => {
    const nextCandidateRunSpy = vi
      .spyOn(runs, "nextCandidateRun")
      .mockResolvedValue(false);

    const toastErrorSpy = vi.spyOn(toast, "error");
    const refreshChatMessages = vi.fn();
    const queryClient = new QueryClient();
    const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(
      () => useNextCandidateSwitch(waitingRun, refreshChatMessages),
      { wrapper },
    );

    result.current.request();

    await waitFor(() => {
      expect(refreshChatMessages).toHaveBeenCalledTimes(1);
    });

    expect(nextCandidateRunSpy).toHaveBeenCalledWith(waitingRun.id);
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: modelQueryKeys.all,
    });
    expect(toastErrorSpy).toHaveBeenCalledWith(
      "The model switch didn't happen. Try again.",
    );
  });
});
