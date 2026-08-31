import { fn } from "storybook/test";

// Type-only import: erased at runtime, so it cannot re-enter the sb.mock
// redirect the way a value re-export would.
import type { AvailableModel } from "../queries";

// Storybook manual mock for the models catalog query (registered globally via
// `sb.mock` in .storybook/preview.tsx). Only the QUERY HOOK is stubbed; the
// two pure helpers are re-implemented here verbatim rather than re-exported
// from "../queries" — sb.mock redirects that specifier back to THIS module,
// so a re-export would be a circular self-import that breaks the preview.

export const modelQueryKeys = {
  all: ["models"] as const,
};

export const fetchModels = fn().mockName("fetchModels");

type MockedModelsQuery = {
  data: { defaultModelId: string; models: Array<AvailableModel> } | undefined;
  isError: boolean;
  isPending: boolean;
};

export const useModelsQuery = fn(
  (): MockedModelsQuery => ({
    data: undefined,
    isError: false,
    isPending: true,
  }),
).mockName("useModelsQuery");

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
