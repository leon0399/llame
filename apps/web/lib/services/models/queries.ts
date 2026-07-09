import { useQuery } from "@tanstack/react-query";

import { api, buildApiUrl } from "@/lib/api/client";

export type AvailableModel = {
  id: string;
  source: "system";
  name?: string;
  description?: string;
  tags?: string[];
  icon?: string;
  contextWindowTokens?: number;
  pricingUsdPer1M?: {
    input?: number;
    cachedInput?: number;
    output?: number;
  };
  knowledgeCutoff?: string;
  reasoning?: boolean;
  website?: string;
  apiDocs?: string;
  modelPage?: string;
  releasedAt?: string;
};

export type ModelsResponse = {
  defaultModelId: string;
  models: AvailableModel[];
};

export const modelQueryKeys = {
  all: ["models"] as const,
};

export const fetchModels = async (): Promise<ModelsResponse> =>
  api.get(buildApiUrl("/api/v1/models")).json<ModelsResponse>();

export const useModelsQuery = () =>
  useQuery({
    queryKey: modelQueryKeys.all,
    queryFn: fetchModels,
    staleTime: 60_000,
  });

export function modelDisplayName(
  modelId: string,
  models?: readonly AvailableModel[],
): string {
  return models?.find((model) => model.id === modelId)?.name ?? modelId;
}

export function hasModelId(
  models: readonly AvailableModel[],
  modelId: string | undefined,
): boolean {
  return modelId !== undefined && models.some((model) => model.id === modelId);
}
