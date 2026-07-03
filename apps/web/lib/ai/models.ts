export interface ChatModel {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
  icon?: string;
  contextWindow?: number;
  price?: {
    input?: number;
    output?: number;
  };
  knowledgeCutoff?: string;
  reasoning?: boolean;
  website?: string;
  apiDocs?: string;
  modelPage?: string;
  releasedAt?: string;
}

export const DEFAULT_MODEL_ID = "openai:gpt-4o";

export const STATIC_CHAT_MODELS: ChatModel[] = [
  {
    id: "openai:gpt-4o",
    name: "GPT-4o",
    description: "Fast, intelligent, flexible GPT model",
    contextWindow: 128000,
    price: {
      input: 2.5 / 1_000_000,
      output: 10.0 / 1_000_000,
    },
    knowledgeCutoff: "2023-10-01",
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/gpt-4o",
    modelPage: "https://platform.openai.com/docs/models/gpt-4o",
    releasedAt: "2024-08-06",
  },
  {
    id: "openai:o3-pro",
    name: "o3-pro",
    contextWindow: 200_000,
    price: {
      input: 20.0 / 1_000_000,
      output: 80.0 / 1_000_000,
    },
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/o3-pro",
    modelPage: "https://platform.openai.com/docs/models/o3-pro",
  },
  {
    id: "openai:o3",
    name: "o3",
    contextWindow: 200_000,
    price: {
      input: 2.0 / 1_000_000,
      output: 8.0 / 1_000_000,
    },
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/o3",
    modelPage: "https://platform.openai.com/docs/models/o3",
    releasedAt: "2024-12-20",
  },
  {
    id: "openai:o3-mini",
    name: "o3-mini",
    description: "A small model alternative to o3",
    contextWindow: 200_000,
    price: {
      input: 1.1 / 1_000_000,
      output: 4.4 / 1_000_000,
    },
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/o3-mini",
    modelPage: "https://platform.openai.com/docs/models/o3-mini",
  },
  {
    id: "openai:o4-mini",
    name: "o4-mini",
    description: "Faster, more affordable reasoning model",
    contextWindow: 200_000,
    price: {
      input: 1.1 / 1_000_000,
      output: 4.4 / 1_000_000,
    },
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/o4-mini",
    modelPage: "https://platform.openai.com/docs/models/o4-mini",
  },
  {
    id: "openai:o4-mini-high",
    name: "o4-mini-high",
    description: "High-effort configuration for o4-mini",
    contextWindow: 200_000,
    price: {
      input: 1.1 / 1_000_000,
      output: 4.4 / 1_000_000,
    },
    reasoning: true,
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/o4-mini",
    modelPage: "https://platform.openai.com/docs/models/o4-mini",
  },
  {
    id: "openai:gpt-4.1",
    name: "GPT-4.1",
    contextWindow: 1_047_576,
    price: {
      input: 2.0 / 1_000_000,
      output: 8.0 / 1_000_000,
    },
    knowledgeCutoff: "2024-06-01",
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/gpt-4.1",
    modelPage: "https://platform.openai.com/docs/models/gpt-4.1",
  },
  {
    id: "openai:gpt-4.1-mini",
    name: "GPT-4.1 Mini",
    contextWindow: 1_047_576,
    price: {
      input: 0.4 / 1_000_000,
      output: 1.6 / 1_000_000,
    },
    knowledgeCutoff: "2024-06-01",
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/gpt-4.1-mini",
    modelPage: "https://platform.openai.com/docs/models/gpt-4.1-mini",
  },
  {
    id: "openai:gpt-4.1-nano",
    name: "GPT-4.1 Nano",
    contextWindow: 1_047_576,
    price: {
      input: 0.1 / 1_000_000,
      output: 0.4 / 1_000_000,
    },
    knowledgeCutoff: "2024-06-01",
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/gpt-4.1-nano",
    modelPage: "https://platform.openai.com/docs/models/gpt-4.1-nano",
  },
  {
    id: "anthropic:claude-4-opus",
    name: "Claude 4 Opus",
    contextWindow: 200_000,
    price: {
      input: 15.0 / 1_000_000,
      output: 75.0 / 1_000_000,
    },
    website: "https://www.anthropic.com",
    apiDocs: "https://docs.anthropic.com",
    modelPage: "https://www.anthropic.com/news/claude-4",
  },
  {
    id: "anthropic:claude-4-sonnet",
    name: "Claude 4 Sonnet",
    contextWindow: 200_000,
    price: {
      input: 3.0 / 1_000_000,
      output: 15.0 / 1_000_000,
    },
    website: "https://www.anthropic.com",
    apiDocs: "https://docs.anthropic.com",
    modelPage: "https://www.anthropic.com/news/claude-4",
  },
  {
    id: "xai:grok-3-mini",
    name: "Grok 3 Mini",
  },
  {
    id: "xai:grok-3-mini-fast",
    name: "Grok 3 Mini Fast",
  },
];

// Keyed on BOTH the catalog's prefixed id ("openai:gpt-4o") AND its bare tail
// ("gpt-4o"): the static catalog is prefixed, but live/persisted model ids (BYOK
// account defaultModel, the instance env model, and what lands in usage.model)
// are BARE — so a bare live id must still resolve to a friendly name when it
// matches a catalog model. Bare tail added second so a genuine prefixed key wins
// on any collision.
const MODEL_NAME_BY_ID = new Map<string, string>();
for (const model of STATIC_CHAT_MODELS) {
  if (!model.name) continue;
  const colon = model.id.indexOf(":");
  if (colon >= 0) MODEL_NAME_BY_ID.set(model.id.slice(colon + 1), model.name);
  MODEL_NAME_BY_ID.set(model.id, model.name);
}

/**
 * Human display name for a persisted model id — "openai:gpt-4o" OR the bare
 * "gpt-4o" both → "GPT-4o". Falls back to the provider-stripped tail, then the
 * raw id, for a BYOK/custom model not in the static catalog (which shows as-is,
 * e.g. "gpt-5.4-mini" — still a readable model name, just unpolished).
 */
export function modelDisplayName(modelId: string): string {
  const known = MODEL_NAME_BY_ID.get(modelId);
  if (known) return known;
  const colon = modelId.indexOf(":");
  const tail = colon >= 0 ? modelId.slice(colon + 1) : modelId;
  return tail || modelId;
}
