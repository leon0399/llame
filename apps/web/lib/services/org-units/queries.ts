import { useQuery } from "@tanstack/react-query";

import {
  getMyOrgUnitEffectiveRole,
  listOrgUnitMemberships,
  listOrgUnits,
} from "../../api/generated/org-units/org-units";
import { getApiErrorStatus } from "../../api/errors";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
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

export async function fetchOrgUnits(): Promise<Array<OrgUnitResponse>> {
  return withOrgUnitsErrors(() =>
    listOrgUnits(undefined, createAuthenticatedBrowserFetch(globalThis.fetch)),
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
): Promise<Array<MembershipResponse>> {
  return withOrgUnitsErrors(() =>
    listOrgUnitMemberships(
      orgUnitId,
      undefined,
      createAuthenticatedBrowserFetch(globalThis.fetch),
    ),
  );
}

function requireOrgUnitId(orgUnitId: string | undefined): string {
  if (orgUnitId === undefined) {
    throw new Error("orgUnitId is required when the query is enabled");
  }
  return orgUnitId;
}

export function useMembershipsQuery(orgUnitId: string | undefined) {
  return useQuery({
    queryKey: orgUnitsQueryKeys.memberships(orgUnitId ?? ""),
    queryFn: () => fetchMemberships(requireOrgUnitId(orgUnitId)),
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
    return await getMyOrgUnitEffectiveRole(
      orgUnitId,
      undefined,
      createAuthenticatedBrowserFetch(globalThis.fetch),
    );
  } catch (error) {
    if (getApiErrorStatus(error) === 404) {
      return null;
    }
    throw await classifyOrgUnitsError(error);
  }
}

export function useMyEffectiveRoleQuery(orgUnitId: string | undefined) {
  return useQuery({
    queryKey: orgUnitsQueryKeys.myRole(orgUnitId ?? ""),
    queryFn: () => fetchMyEffectiveRole(requireOrgUnitId(orgUnitId)),
    enabled: orgUnitId !== undefined,
    retry: false,
  });
}
