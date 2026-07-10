import { useQuery } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";

/**
 * BYOK usage/cost — aggregated from the per-turn usage the api persists.
 * Read-only; the whole view is windowed to `days` (UTC). costUsd is an ESTIMATE
 * (built-in price table; no provider invoice under BYOK).
 */
export type UsageSummary = {
  days: number;
  total: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    turnsWithKnownCost: number;
    turnsWithUnknownCost: number;
  };
  byModel: Array<{
    /** Opaque llame model id (e.g. `system:openai:gpt-4o`); resolve display name via useModelsQuery(). */
    modelId: string;
    totalTokens: number;
    costUsd: number;
  }>;
  byDay: Array<{ date: string; totalTokens: number; costUsd: number }>;
};

export async function fetchUsage(days: number): Promise<UsageSummary> {
  const url = new URL(buildApiUrl("/api/v1/me/usage"));
  url.searchParams.set("days", String(days));
  return api.get(url.toString()).json<UsageSummary>();
}

export const usageQueryKeys = {
  summary: (days: number) => ["me", "usage", days] as const,
};

export const useUsageQuery = (days: number) =>
  useQuery({
    queryKey: usageQueryKeys.summary(days),
    queryFn: () => fetchUsage(days),
    staleTime: 60_000,
  });
