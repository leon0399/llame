import { useQuery } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import type { Personalization } from "./types";

// Serializable-array key factory (same convention as orgUnitsQueryKeys /
// chatQueryKeys): generic resource → specific resource.
export const personalizationQueryKeys = {
  all: ["personalization"] as const,
  mine: () => [...personalizationQueryKeys.all, "me"] as const,
};

export async function fetchPersonalization(): Promise<Personalization> {
  return api
    .get(buildApiUrl("/api/v1/me/personalization"))
    .json<Personalization>();
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
