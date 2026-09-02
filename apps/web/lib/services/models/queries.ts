import { useQuery } from "@tanstack/react-query";

import { listModels } from "../../api/generated/models/models";
import type {
  AvailableModelResponse,
  ModelsResponse as GeneratedModelsResponse,
} from "../../api/generated/models";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

export type AvailableModel = AvailableModelResponse;
export type ModelsResponse = GeneratedModelsResponse;

export const modelQueryKeys = {
  all: ["models"] as const,
};

function authenticatedFetch(): typeof fetch {
  return createAuthenticatedBrowserFetch(globalThis.fetch);
}

export const fetchModels = async (): Promise<ModelsResponse> =>
  listModels(undefined, authenticatedFetch());

export const useModelsQuery = () =>
  useQuery({
    queryKey: modelQueryKeys.all,
    queryFn: fetchModels,
    staleTime: 60_000,
  });

export function modelDisplayName(
  modelId: string,
  models?: ReadonlyArray<AvailableModel>,
): string {
  return models?.find((model) => model.id === modelId)?.name ?? modelId;
}

export function hasModelId(
  models: ReadonlyArray<AvailableModel>,
  modelId: string | undefined,
): boolean {
  return modelId !== undefined && models.some((model) => model.id === modelId);
}
