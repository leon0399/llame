import { useQuery } from "@tanstack/react-query";

import { listMachines } from "../../api/generated/machines/machines";
import type { MachineResponse } from "../../api/generated/models";
import { getApiErrorStatus } from "../../api/errors";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

export type { MachineResponse };

/**
 * How often the read-only status view refreshes. Machines are reached over SSH
 * by a background probe, so the list changes without any user action; 15s
 * keeps the settings section and the Workspace indicator honest without
 * polling a hidden tab (React Query already pauses the interval in the
 * background).
 */
export const MACHINES_REFETCH_INTERVAL_MS = 15_000;

// Serializable-array key factory: generic resource → the caller's resource.
export const machinesQueryKeys = {
  all: ["machines"] as const,
  list: () => [...machinesQueryKeys.all, "list"] as const,
};

/**
 * The configured Machines, or an empty list when the operator configured none.
 * An instance without a `machines` section has no route at all — the API
 * answers 404 — and that is not a failure to display: there is no Machine
 * surface to offer. Any other failure propagates so the caller can say so.
 */
export async function fetchMachines(): Promise<Array<MachineResponse>> {
  try {
    return await listMachines(
      undefined,
      createAuthenticatedBrowserFetch(globalThis.fetch),
    );
  } catch (error) {
    if (getApiErrorStatus(error) === 404) return [];
    throw error;
  }
}

/**
 * Polled Machine status. `enabled` lets a caller that only cares about one
 * Machine Workspace stay off the network for local Workspaces.
 */
export function useMachinesQuery(enabled = true) {
  return useQuery({
    queryKey: machinesQueryKeys.list(),
    queryFn: fetchMachines,
    enabled,
    refetchInterval: MACHINES_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}
