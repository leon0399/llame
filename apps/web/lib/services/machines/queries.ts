import { useQuery } from "@tanstack/react-query";

import { listMachines } from "../../api/generated/machines/machines";
import type { MachineResponse } from "../../api/generated/models";
import { getApiErrorStatus } from "../../api/errors";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

export type { MachineResponse };

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
 * Machine status, kept current by the live socket's `machine.upserted`
 * messages rather than a poll. The hub's probe writes each Machine's status
 * about once a minute, so a client without a live connection shows the list
 * as of its last fetch (the socket's `resync` and reconnect refetches cover
 * gaps while one is open). `enabled` lets a caller that only cares about one
 * Machine Workspace stay off the network for local Workspaces.
 */
export function useMachinesQuery(enabled = true) {
  return useQuery({
    queryKey: machinesQueryKeys.list(),
    queryFn: fetchMachines,
    enabled,
  });
}
