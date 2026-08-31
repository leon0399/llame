import { getRun } from "../../api/generated/runs/runs";
import { listActiveRuns } from "../../api/generated/me/me";
import type {
  ActiveRunResponse,
  RunResponse,
} from "../../api/generated/models";
import { getApiErrorStatus } from "../../api/errors";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

// Feature key factory (apps/web/AGENTS.md convention), mirroring chatQueryKeys
// in ./queries.ts: generic resource -> specific resource/subresource.
export const activeRunsQueryKeys = {
  all: ["active-runs"] as const,
  list: () => [...activeRunsQueryKeys.all, "list"] as const,
  run: (runId: string) => [...activeRunsQueryKeys.all, "run", runId] as const,
};

export type Run = Pick<RunResponse, "id" | "status">;

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
