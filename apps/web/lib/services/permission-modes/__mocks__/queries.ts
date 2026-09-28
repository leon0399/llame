import { fn } from "storybook/test";

import type { PermissionModesResponse } from "../queries";

// Storybook manual mock for the enabled permission modes query (registered in
// preview.tsx). The stories control the hook result without calling the API.
export const permissionModesQueryKey = ["permission-modes"] as const;

export const fetchPermissionModes = fn().mockName("fetchPermissionModes");

type MockedPermissionModesQuery = {
  data: PermissionModesResponse | undefined;
  isError: boolean;
  isPending: boolean;
};

export const usePermissionModesQuery = fn(
  (): MockedPermissionModesQuery => ({
    data: undefined,
    isError: false,
    isPending: true,
  }),
).mockName("usePermissionModesQuery");
