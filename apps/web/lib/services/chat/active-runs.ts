import { getRun } from "../../api/generated/runs/runs";
import {
  replaceEqualDeep,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import type { ChatMessagesResponse } from "./history";
import type { ChatLatestRunResponse } from "../../api/generated/models";
import { isNonNullObject, isString, isNumber } from "./context-item-envelope";
import { isTerminalRunStatus } from "./run-notifications";
import { listActiveRuns } from "../../api/generated/me/me";
import type {
  ActiveRunResponse,
  RunResponse,
} from "../../api/generated/models";
import { getApiErrorStatus } from "../../api/errors";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import { chatQueryKeys } from "./queries";

// Feature key factory (apps/web/AGENTS.md convention), mirroring chatQueryKeys
// in ./queries.ts: generic resource -> specific resource/subresource.
export const activeRunsQueryKeys = {
  all: ["active-runs"] as const,
  list: () => [...activeRunsQueryKeys.all, "list"] as const,
  run: (runId: string) => [...activeRunsQueryKeys.all, "run", runId] as const,
};

export type Run = Pick<
  RunResponse,
  "id" | "status" | "kind" | "quotaWait" | "error"
>;

/**
 * Poll a run's status (owner-scoped server-side). Returns null on 404 — the run
 * is gone (e.g. its chat was deleted), so the caller drops it silently rather
 * than surfacing a spurious failure.
 */
export async function fetchRun(runId: string): Promise<Run | null> {
  try {
    return await getRun(runId, undefined, authenticatedFetch());
  } catch (error) {
    if (getApiErrorStatus(error) === 404) {
      return null;
    }

    throw error;
  }
}

/** One of the caller's in-flight runs (from `GET /api/v1/me/runs?status=active`). */
export type ActiveRun = ActiveRunResponse;

export async function fetchActiveRuns(): Promise<Array<ActiveRun>> {
  return listActiveRuns({ status: "active" }, undefined, authenticatedFetch());
}

function authenticatedFetch(): typeof fetch {
  return createAuthenticatedBrowserFetch(globalThis.fetch);
}

/**
 * The `trackRun(runId, chatId, title)` argument tuples for a fetched active-run
 * set. Pure, so the re-hydration mapping is unit-tested without a DOM. Falls
 * back to a placeholder label for a still-untitled chat — "New chat", matching
 * `UNTITLED_CHAT_LABEL` in chat-list-sidebar/chat-list.tsx (keep these two in
 * sync; not imported directly to avoid a lib/services -> components edge).
 */
export function activeRunsToTrackArgs(
  runs: Array<ActiveRun>,
): Array<[string, string, string]> {
  return runs.map((r) => [r.runId, r.chatId, r.chatTitle ?? "New chat"]);
}

function nextLatestRunFromUpdate(
  previous: ChatLatestRunResponse | null,
  run: Run,
): ChatLatestRunResponse | null {
  if (previous === null || previous.id !== run.id) return previous;

  if (isTerminalRunStatus(previous.status)) return previous;

  const failed = run.status === "failed";

  const error =
    (failed || run.status === "expired") && isNonNullObject(run.error)
      ? run.error
      : null;

  const errorCode = error?.["code"];
  const errorResetsAt = error?.["resetsAt"];

  return replaceEqualDeep(previous, {
    ...previous,
    status: run.status,
    quotaWait: run.quotaWait,
    error: isString(error?.["message"]) ? error["message"] : null,
    errorCode: failed && isString(errorCode) ? errorCode : null,
    errorResetsAt:
      failed && isNumber(errorResetsAt) && Number.isFinite(errorResetsAt)
        ? errorResetsAt
        : null,
  });
}

function applyRunUpdateToHistory(
  data: InfiniteData<ChatMessagesResponse, number | null> | undefined,
  run: Run,
): InfiniteData<ChatMessagesResponse, number | null> | undefined {
  if (!data) return data;

  let changed = false;

  const pages = data.pages.map((page) => {
    const latestRun = nextLatestRunFromUpdate(page.latestRun, run);

    if (latestRun === page.latestRun) return page;

    changed = true;

    return { ...page, latestRun };
  });

  return changed ? { ...data, pages } : data;
}

function needsRunHistoryRefresh(
  queryClient: QueryClient,
  chatId: string,
  run: Run,
): boolean {
  return (
    !isTerminalRunStatus(run.status) &&
    queryClient
      .getQueriesData<InfiniteData<ChatMessagesResponse, number | null>>({
        queryKey: chatQueryKeys.messages(chatId),
      })
      .some(([, history]) =>
        history?.pages.some((page) => page.latestRun?.id !== run.id),
      )
  );
}

async function refreshRunHistory(
  queryClient: QueryClient,
  chatId: string,
  runId: string,
): Promise<void> {
  const queryKey = chatQueryKeys.messages(chatId);

  await queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });

  const afterRead = queryClient.getQueryData<Run>(
    activeRunsQueryKeys.run(runId),
  );

  // The joined read may predate this Run or only load an older history page.
  if (afterRead && needsRunHistoryRefresh(queryClient, chatId, afterRead)) {
    await queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
  }

  const latest = queryClient.getQueryData<Run>(activeRunsQueryKeys.run(runId));

  if (!latest) return;
  queryClient.setQueriesData<InfiniteData<ChatMessagesResponse, number | null>>(
    { queryKey },
    (previous) => {
      const next = applyRunUpdateToHistory(previous, latest);

      return next === previous ? undefined : next;
    },
  );
}

export function syncRunHistory(
  queryClient: QueryClient,
  chatId: string,
  run: Run,
): void {
  const queryKey = chatQueryKeys.messages(chatId);

  queryClient.setQueriesData<InfiniteData<ChatMessagesResponse, number | null>>(
    { queryKey },
    (previous) => {
      const next = applyRunUpdateToHistory(previous, run);

      return next === previous ? undefined : next;
    },
  );

  if (needsRunHistoryRefresh(queryClient, chatId, run)) {
    void refreshRunHistory(queryClient, chatId, run.id);
  }
}
