import type { UIMessage } from "ai";
import { HTTPError } from "ky";
import {
  queryOptions,
  type QueryFunctionContext,
  useQuery,
} from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";

export type ContextReceiptTool = {
  id: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type RunContextReceipt = {
  modelId: string;
  promptSource: "project_default" | "model_override";
  systemPrompt: string;
  tools: ContextReceiptTool[];
  contentHash: string;
  createdAt: string;
};

export const runQueryKeys = {
  all: ["runs"] as const,
  detail: (runId: string) => [...runQueryKeys.all, runId] as const,
  contextReceipt: (runId: string) =>
    [...runQueryKeys.detail(runId), "context-receipt"] as const,
};

type ContextReceiptQueryKey = ReturnType<typeof runQueryKeys.contextReceipt>;

export function fetchRunContextReceipt({
  queryKey: [, runId],
  signal,
}: QueryFunctionContext<ContextReceiptQueryKey>): Promise<RunContextReceipt> {
  return api
    .get(
      buildApiUrl(`/api/v1/runs/${encodeURIComponent(runId)}/context-receipt`),
      { signal },
    )
    .json<RunContextReceipt>();
}

export function runContextReceiptQueryOptions(runId: string) {
  return queryOptions({
    queryKey: runQueryKeys.contextReceipt(runId),
    queryFn: fetchRunContextReceipt,
  });
}

export function useRunContextReceipt(runId: string | null, enabled: boolean) {
  return useQuery({
    ...runContextReceiptQueryOptions(runId ?? ""),
    enabled: enabled && runId !== null,
  });
}

/**
 * The run id to cancel when the user hits stop. While a run streams, the last
 * message is the assistant turn whose id IS the run id (the bridge's start-chunk
 * surrogate). Returns null when the last message isn't an assistant turn — the
 * brief "submitted" window before the first chunk, where the last message is
 * the user turn and no run id is client-known yet → nothing to cancel. Pure so
 * the branching (the part most likely to regress under a refactor) is testable
 * without rendering the chat.
 */
export function runIdToCancel(
  messages: ReadonlyArray<Pick<UIMessage, "id" | "role">>,
): string | null {
  const last = messages.at(-1);
  return last?.role === "assistant" ? last.id : null;
}

/**
 * Cancel a durable run (#48). `PATCH /api/v1/runs/:id { status: 'cancelled' }`
 * is the only client-writable transition — it stamps the cross-process cancel
 * signal AND aborts the in-process model call, so wiring the UI stop button to
 * it makes "stop" actually halt server-side generation (saving tokens/cost),
 * not just close the client's SSE.
 *
 * Best-effort by design: a run that is already gone (404) or already terminal
 * (409) makes the stop moot, so those are swallowed; any other error
 * propagates. Idempotent server-side (re-cancel → 200).
 */
export async function cancelRun(runId: string): Promise<void> {
  try {
    await api.patch(buildApiUrl(`/api/v1/runs/${runId}`), {
      json: { status: "cancelled" },
    });
  } catch (error) {
    if (
      error instanceof HTTPError &&
      (error.response.status === 404 || error.response.status === 409)
    ) {
      return;
    }
    throw error;
  }
}
