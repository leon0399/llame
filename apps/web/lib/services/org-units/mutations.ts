import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import { OrgUnitsApiError, withOrgUnitsErrors } from "./errors";
import { orgUnitsQueryKeys } from "./queries";
import type {
  GrantableRole,
  MembershipResponse,
  OrgUnitResponse,
  OrgUnitType,
} from "./types";

export async function createRootOrg(input: {
  name: string;
}): Promise<OrgUnitResponse> {
  return withOrgUnitsErrors(() =>
    api
      // No explicit type: the API's createRoot defaults a root to
      // 'organization' — the invariant lives server-side, for every client.
      .post(buildApiUrl("/api/v1/org-units"), { json: input })
      .json<OrgUnitResponse>(),
  );
}

export function useCreateRootOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createRootOrg,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orgUnitsQueryKeys.lists() }),
  });
}

export async function createChildOrg(input: {
  parentId: string;
  name: string;
  /** Child dialog's type segment (task 4.3) — group/team/department only. */
  type?: OrgUnitType;
}): Promise<OrgUnitResponse> {
  return withOrgUnitsErrors(() =>
    api
      .post(buildApiUrl(`/api/v1/org-units/${input.parentId}/children`), {
        json: { name: input.name, ...(input.type ? { type: input.type } : {}) },
      })
      .json<OrgUnitResponse>(),
  );
}

export function useCreateChildOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createChildOrg,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orgUnitsQueryKeys.lists() }),
  });
}

export type UpdateOrgUnitInput = {
  orgUnitId: string;
  name?: string;
  parentId?: string | null;
};

export async function updateOrgUnit(
  input: UpdateOrgUnitInput,
): Promise<OrgUnitResponse> {
  const { orgUnitId, ...body } = input;
  return withOrgUnitsErrors(() =>
    api
      .patch(buildApiUrl(`/api/v1/org-units/${orgUnitId}`), { json: body })
      .json<OrgUnitResponse>(),
  );
}

/**
 * Rename and/or move (D5 PATCH semantics). On a concurrent-reorganization
 * 409, the org-admin-ui spec requires an automatic refetch of the tree
 * (not just an error message) so the user retries against current state.
 */
export function useUpdateOrgUnit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateOrgUnit,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orgUnitsQueryKeys.lists() }),
    onError: (error) => {
      if (
        error instanceof OrgUnitsApiError &&
        error.kind === "concurrent-change"
      ) {
        void queryClient.invalidateQueries({
          queryKey: orgUnitsQueryKeys.lists(),
        });
      }
    },
  });
}

export async function deleteOrgUnit(orgUnitId: string): Promise<void> {
  await withOrgUnitsErrors(() =>
    api.delete(buildApiUrl(`/api/v1/org-units/${orgUnitId}`)),
  );
}

export function useDeleteOrgUnit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteOrgUnit,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orgUnitsQueryKeys.lists() }),
  });
}

export type GrantMembershipInput = {
  orgUnitId: string;
  userId: string;
  role: GrantableRole;
};

export async function grantMembership(
  input: GrantMembershipInput,
): Promise<void> {
  await withOrgUnitsErrors(() =>
    api.post(buildApiUrl(`/api/v1/org-units/${input.orgUnitId}/memberships`), {
      json: { userId: input.userId, role: input.role },
    }),
  );
}

export function useGrantMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: grantMembership,
    onSuccess: (_data, { orgUnitId }) => {
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.memberships(orgUnitId),
      });
      // The grantee may be the CALLER (creator-visibility edge: they see the
      // unit as its creator but hold no membership yet) — refresh "my role
      // here" so role-gated UI reflects the new effective role immediately.
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.myRole(orgUnitId),
      });
    },
  });
}

export type ChangeMembershipRoleInput = {
  orgUnitId: string;
  userId: string;
  role: GrantableRole;
};

export async function changeMembershipRole(
  input: ChangeMembershipRoleInput,
): Promise<MembershipResponse> {
  return withOrgUnitsErrors(() =>
    api
      .patch(
        buildApiUrl(
          `/api/v1/org-units/${input.orgUnitId}/memberships/${input.userId}`,
        ),
        { json: { role: input.role } },
      )
      .json<MembershipResponse>(),
  );
}

export function useChangeMembershipRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: changeMembershipRole,
    onSuccess: (_data, { orgUnitId }) => {
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.memberships(orgUnitId),
      });
      // The caller may have changed their OWN role — refresh "my role here" too.
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.myRole(orgUnitId),
      });
    },
  });
}

export type RevokeMembershipInput = { orgUnitId: string; userId: string };

export async function revokeMembership(
  input: RevokeMembershipInput,
): Promise<void> {
  await withOrgUnitsErrors(() =>
    api.delete(
      buildApiUrl(
        `/api/v1/org-units/${input.orgUnitId}/memberships/${input.userId}`,
      ),
    ),
  );
}

export function useRevokeMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeMembership,
    onSuccess: (_data, { orgUnitId }) => {
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.memberships(orgUnitId),
      });
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.myRole(orgUnitId),
      });
      // Self-leave can make the unit disappear from the visible list.
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.lists(),
      });
    },
  });
}
