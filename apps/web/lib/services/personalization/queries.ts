import { useQuery } from "@tanstack/react-query";

import { getPersonalization } from "../../api/generated/personalization/personalization";
import type { PersonalizationResponse } from "../../api/generated/models";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

// Serializable-array key factory (same convention as orgUnitsQueryKeys /
// chatQueryKeys): generic resource → specific resource.
export const personalizationQueryKeys = {
  all: ["personalization"] as const,
  mine: () => [...personalizationQueryKeys.all, "me"] as const,
};

function authenticatedFetch(): typeof fetch {
  return createAuthenticatedBrowserFetch(globalThis.fetch);
}

export async function fetchPersonalization(): Promise<PersonalizationResponse> {
  return getPersonalization(undefined, authenticatedFetch());
}

/**
 * The caller's own profile. Never 404s: an owner who has written nothing gets
 * the defaults back, so there is no first-use branch to handle here.
 */
export function usePersonalizationQuery() {
  return useQuery({
    queryKey: personalizationQueryKeys.mine(),
    queryFn: fetchPersonalization,
  });
}
