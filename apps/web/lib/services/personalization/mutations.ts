import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import { personalizationQueryKeys } from "./queries";
import type { Personalization, PersonalizationUpdate } from "./types";

export const personalizationMutationKeys = {
  all: ["personalization", "mutations"] as const,
  update: () => [...personalizationMutationKeys.all, "update"] as const,
};

export async function updatePersonalization(
  input: PersonalizationUpdate,
): Promise<Personalization> {
  return api
    .patch(buildApiUrl("/api/v1/me/personalization"), { json: input })
    .json<Personalization>();
}

/**
 * Follows the repo's documented mutation discipline (see the reference note in
 * `services/org-units/mutations.ts`): cancel in-flight queries for the affected
 * key → snapshot → patch → roll back on error → always invalidate on settle.
 *
 * Patched optimistically because the next state IS computable here: the server
 * assigns nothing the client cannot predict, so the toggles flip instantly
 * rather than waiting a round trip to answer a switch the user just clicked.
 */
export function useUpdatePersonalizationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: personalizationMutationKeys.update(),
    mutationFn: updatePersonalization,
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: personalizationQueryKeys.mine(),
      });
      const previous = queryClient.getQueryData<Personalization>(
        personalizationQueryKeys.mine(),
      );
      if (previous) {
        queryClient.setQueryData<Personalization>(
          personalizationQueryKeys.mine(),
          { ...previous, ...input },
        );
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          personalizationQueryKeys.mine(),
          context.previous,
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: personalizationQueryKeys.mine(),
      });
    },
  });
}
