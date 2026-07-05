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
