import { useQuery } from "@tanstack/react-query";

import { listPermissionModes } from "../../api/generated/permission-modes/permission-modes";
import type { PermissionModesResponse } from "../../api/generated/models";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

export type { PermissionModesResponse };

export const permissionModesQueryKey = ["permission-modes"] as const;

function authenticatedFetch(): typeof fetch {
  return createAuthenticatedBrowserFetch(globalThis.fetch);
}

export const fetchPermissionModes =
  async (): Promise<PermissionModesResponse> =>
    listPermissionModes(undefined, authenticatedFetch());

export const usePermissionModesQuery = () =>
  useQuery({
    queryKey: permissionModesQueryKey,
    queryFn: fetchPermissionModes,
    staleTime: 60_000,
  });
