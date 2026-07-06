import { useQuery } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import type { ChatModel } from "@/lib/ai/models";
import { enrichAvailableModels, type AvailableModel } from "./enrich";

export type { AvailableModel };

/**
 * Fetch the models the authenticated caller can actually use (#76): their
 * provider accounts' default models plus the instance-env model. This is the
 * live availability set — the chat selector must not offer anything else, or
 * the send is rejected (422). Static display metadata (name, description, price,
 * context window, icon) is merged in via `enrichAvailableModels`.
 */
export const fetchModels = async (): Promise<ChatModel[]> => {
  const available = await api
    .get(buildApiUrl("/api/v1/models"))
    .json<AvailableModel[]>();

  return enrichAvailableModels(available);
};

export const modelQueryKeys = {
  all: ["models"] as const,
};

export const useModelsQuery = () =>
  useQuery({
    queryKey: modelQueryKeys.all,
    queryFn: fetchModels,
  });
