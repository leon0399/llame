import { fn } from "storybook/test";

import type { MachineResponse } from "../../../api/generated/models";

/**
 * Storybook manual mock for the Machines status query (registered in
 * preview.tsx). The stories control the hook result without calling an API.
 *
 * The query-key factory is re-declared rather than re-exported from
 * `../queries`: `sb.mock` redirects that specifier to THIS module, so a
 * re-export would resolve back here and break the preview. The memory and
 * models services carry the same duplication for the same reason.
 */
export const machinesQueryKeys = {
  all: ["machines"] as const,
  list: () => [...machinesQueryKeys.all, "list"] as const,
};

export const fetchMachines = fn().mockName("fetchMachines");

export const refetchMachines = fn().mockName("refetchMachines");

export const useMachinesQuery = fn(
  (_enabled: boolean = true) =>
    ({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: refetchMachines,
    }) satisfies {
      data: Array<MachineResponse> | undefined;
      isPending: boolean;
      isError: boolean;
      refetch: typeof refetchMachines;
    },
).mockName("useMachinesQuery");
