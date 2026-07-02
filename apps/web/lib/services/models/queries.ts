import { useQuery } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import { STATIC_CHAT_MODELS, type ChatModel } from "@/lib/ai/models";

/** The api's available-model shape (#76). */
export type AvailableModel = {
  id: string;
  label: string;
  providerType: string;
  source: "byok" | "instance";
  providerAccountId: string | null;
};

/**
 * Fetch the models the authenticated caller can actually use (#76): their
 * provider accounts' default models plus the instance-env model. This is the
 * live availability set — the chat selector must not offer anything else, or
 * the send is rejected (422). Static display metadata (icons, pricing) is
 * merged in by id when known; unknown ids still show with their label.
 */
export const fetchModels = async (): Promise<ChatModel[]> => {
  const available = await api
    .get(buildApiUrl("/api/v1/models"))
    .json<AvailableModel[]>();

  const staticById = new Map(STATIC_CHAT_MODELS.map((m) => [m.id, m]));
  return available.map((model) => {
    const enrichment = staticById.get(model.id);
    return {
      ...(enrichment ?? {}),
      id: model.id,
      name: enrichment?.name ?? model.label,
    };
  });
};

export const modelQueryKeys = {
  all: ["models"] as const,
};

export const useModelsQuery = () =>
  useQuery({
    queryKey: modelQueryKeys.all,
    queryFn: fetchModels,
  });
