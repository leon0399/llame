import { api, buildApiUrl } from "../../api/client";

/** One of the caller's in-flight runs (from `GET /api/v1/me/runs?status=active`). */
export type ActiveRun = {
  runId: string;
  chatId: string;
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
 * set. Pure, so the re-hydration mapping is unit-tested without a DOM.
 */
export function activeRunsToTrackArgs(
  runs: ActiveRun[],
): Array<[string, string, string]> {
  return runs.map((r) => [r.runId, r.chatId, r.chatTitle ?? "Untitled chat"]);
}
