import { useState } from "react";

import { useQueries } from "@tanstack/react-query";

import {
  activeRunsQueryKeys,
  fetchRun,
  type Run,
} from "@/lib/services/chat/active-runs";
import { isTerminalRunStatus } from "@/lib/services/chat/run-notifications";
import { useOptionalLiveUpdates } from "@/contexts/live-updates-context";

export { useOptionalLiveUpdates };

const POLL_MS = 4000;

export type ActiveRunQuery = { data: Run | null | undefined };

type ActiveEntry = readonly [string, { chatId: string }];

const EMPTY_RUN_STATUSES: ReadonlyMap<string, Run["status"]> = new Map();

// Poll each tracked run until terminal, including while the tab is hidden.
export function useActiveRunQueries(activeEntries: ReadonlyArray<ActiveEntry>) {
  const liveConnected = useOptionalLiveUpdates()?.connected ?? false;

  return useQueries({
    queries: activeEntries.map(([runId]) => ({
      queryKey: activeRunsQueryKeys.run(runId),
      queryFn: () => fetchRun(runId),
      staleTime: 0,
      refetchInterval: (query: { state: { data?: Run | null } }) => {
        const data = query.state.data;

        if (data === undefined) return POLL_MS;

        if (data === null) return false;

        if (liveConnected && !isTerminalRunStatus(data.status)) return false;

        return isTerminalRunStatus(data.status) ? false : POLL_MS;
      },
      refetchIntervalInBackground: true,
    })),
  });
}

function nextRunStatusesByChat(
  prev: ReadonlyMap<string, Run["status"]>,
  activeEntries: ReadonlyArray<ActiveEntry>,
  runQueries: ReadonlyArray<ActiveRunQuery>,
): ReadonlyMap<string, Run["status"]> {
  const statuses = new Map<string, Run["status"]>();

  activeEntries.forEach(([, meta], index) => {
    const status = runQueries[index]?.data?.status;

    if (status === undefined || isTerminalRunStatus(status)) return;

    const current = statuses.get(meta.chatId);

    if (current === undefined || current === "awaiting_jobs") {
      statuses.set(meta.chatId, status);
    }
  });

  if (statuses.size === prev.size) {
    for (const [chatId, status] of statuses) {
      if (prev.get(chatId) !== status) return statuses;
    }

    return prev;
  }

  return statuses;
}

export function useRunStatusesByChat(
  activeEntries: ReadonlyArray<ActiveEntry>,
  runQueries: ReadonlyArray<ActiveRunQuery>,
): ReadonlyMap<string, Run["status"]> {
  const [previousStatuses, setPreviousStatuses] = useState(EMPTY_RUN_STATUSES);

  const statuses = nextRunStatusesByChat(
    previousStatuses,
    activeEntries,
    runQueries,
  );

  if (statuses !== previousStatuses) setPreviousStatuses(statuses);

  return statuses;
}
