import { HTTPError } from "ky";

import { api, buildApiUrl } from "../../api/client";

export type Run = { id: string; status: string };

/**
 * Poll a run's status (owner-scoped server-side). Returns null on 404 — the run
 * is gone (e.g. its chat was deleted), so the caller drops it silently rather
 * than surfacing a spurious failure.
 */
export async function fetchRun(runId: string): Promise<Run | null> {
  try {
    return await api.get(buildApiUrl(`/api/v1/runs/${runId}`)).json<Run>();
  } catch (error) {
    if (error instanceof HTTPError && error.response.status === 404) {
      return null;
    }
    throw error;
  }
}

/** One of the caller's in-flight runs (from `GET /api/v1/me/runs?status=active`). */
export type ActiveRun = {
  runId: string;
  chatId: string;
  // Nullable: a chat's title is generated asynchronously (#78) and may still
  // be null while a run against it is active.
  chatTitle: string | null;
  status: string;
  createdAt: string;
};

export async function fetchActiveRuns(): Promise<ActiveRun[]> {
  const url = new URL(buildApiUrl("/api/v1/me/runs"));
  url.searchParams.set("status", "active");
  return api.get(url.toString()).json<ActiveRun[]>();
}

/**
 * The `trackRun(runId, chatId, title)` argument tuples for a fetched active-run
 * set. Pure, so the re-hydration mapping is unit-tested without a DOM. Falls
 * back to a placeholder label for a still-untitled chat, matching the sidebar's
 * own untitled-chat convention.
 */
export function activeRunsToTrackArgs(
  runs: ActiveRun[],
): Array<[string, string, string]> {
  return runs.map((r) => [r.runId, r.chatId, r.chatTitle ?? "Untitled chat"]);
}
