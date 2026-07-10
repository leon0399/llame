import { useQuery } from "@tanstack/react-query";
import { HTTPError } from "ky";

import { api, buildApiUrl } from "../../api/client";
import { classifyOrgUnitsError, withOrgUnitsErrors } from "./errors";
import type {
  EffectiveRoleResponse,
  MembershipResponse,
  OrgUnitResponse,
} from "./types";

// Serializable-array key factory (TkDodo's "Effective React Query Keys",
// same convention as chatQueryKeys in ../chat/queries.ts): generic resource →
// specific resource → subresource.
export const orgUnitsQueryKeys = {
  all: ["org-units"] as const,
  lists: () => [...orgUnitsQueryKeys.all, "list"] as const,
  detail: (orgUnitId: string) => [...orgUnitsQueryKeys.all, orgUnitId] as const,
  memberships: (orgUnitId: string) =>
    [...orgUnitsQueryKeys.detail(orgUnitId), "memberships"] as const,
  myRole: (orgUnitId: string) =>
    [...orgUnitsQueryKeys.detail(orgUnitId), "me"] as const,
};

export async function fetchOrgUnits(): Promise<OrgUnitResponse[]> {
  return withOrgUnitsErrors(() =>
    api.get(buildApiUrl("/api/v1/org-units")).json<OrgUnitResponse[]>(),
  );
}

/** Visible units, path-ordered by the API (D5) — parents sort before children. */
export function useOrgUnitsQuery() {
  return useQuery({
    queryKey: orgUnitsQueryKeys.lists(),
    queryFn: fetchOrgUnits,
  });
}

export async function fetchMemberships(
  orgUnitId: string,
): Promise<MembershipResponse[]> {
  return withOrgUnitsErrors(() =>
    api
      .get(buildApiUrl(`/api/v1/org-units/${orgUnitId}/memberships`))
      .json<MembershipResponse[]>(),
  );
}

export function useMembershipsQuery(orgUnitId: string | undefined) {
  return useQuery({
    queryKey: orgUnitsQueryKeys.memberships(orgUnitId ?? ""),
    queryFn: () => fetchMemberships(orgUnitId as string),
    enabled: orgUnitId !== undefined,
  });
}

/**
 * The caller's effective role on a unit. A 404 here is a legitimate,
 * non-error outcome (the child-org-creator-without-membership edge: created
 * via creator visibility, no membership on the path — see
 * IdentityService.resolveRole) — mapped to `null`, not thrown/retried.
 */
export async function fetchMyEffectiveRole(
  orgUnitId: string,
): Promise<EffectiveRoleResponse | null> {
  try {
    return await api
      .get(buildApiUrl(`/api/v1/org-units/${orgUnitId}/memberships/me`))
      .json<EffectiveRoleResponse>();
  } catch (error) {
    if (error instanceof HTTPError && error.response.status === 404) {
      return null;
    }
    throw await classifyOrgUnitsError(error);
  }
}

export function useMyEffectiveRoleQuery(orgUnitId: string | undefined) {
  return useQuery({
    queryKey: orgUnitsQueryKeys.myRole(orgUnitId ?? ""),
    queryFn: () => fetchMyEffectiveRole(orgUnitId as string),
    enabled: orgUnitId !== undefined,
    retry: false,
  });
}
