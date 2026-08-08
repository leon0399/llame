import { createHash } from 'node:crypto';

import { type ModelToolDeclaration } from '../db/schema';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { resolveAdvertisedTools } from '../tools/registry';
import { resolveJsonSchema } from '../tools/schema-utils';
import { type Tool } from '../tools/types';

export type EffectiveContextSnapshotInput = {
  contentHash: string;
  promptHash: string;
  toolHash: string;
  source: SystemModelCatalogEntry['systemPromptSource'];
  systemPrompt: string;
  toolDeclarations: ModelToolDeclaration[];
};

const compareCodePoints = (left: string, right: string): number => {
  const leftScalars = Array.from(left, (scalar) => scalar.codePointAt(0) ?? 0);
  const rightScalars = Array.from(
    right,
    (scalar) => scalar.codePointAt(0) ?? 0,
  );
  const sharedLength = Math.min(leftScalars.length, rightScalars.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftScalars[index] - rightScalars[index];
    if (difference !== 0) {
      return difference;
    }
  }

  return leftScalars.length - rightScalars.length;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function hash(domain: string, payload: string): string {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(payload, 'utf8')
    .digest('hex');
}

export async function resolveEffectiveContext(input: {
  model: SystemModelCatalogEntry;
  /**
   * The prompt exactly as it will be sent, already rendered with the owner's
   * per-user context by `SystemPromptsService`.
   *
   * Taken as a rendered string rather than rendered in here so the ordering
   * "render, THEN hash" is enforced by the signature instead of by a comment:
   * everything below hashes this value, which is what content-addresses the
   * snapshot by what was actually sent. Two owners on one model therefore bind
   * distinct snapshots, and a personalization edit produces a new snapshot
   * rather than mutating the old one.
   */
  systemPrompt: string;
  allowedToolIds: ReadonlySet<string>;
  candidates?: Iterable<Tool>;
}): Promise<EffectiveContextSnapshotInput> {
  const { systemPrompt } = input;
  const advertisedTools = resolveAdvertisedTools(
    input.allowedToolIds,
    input.candidates,
  ).sort((left, right) => compareCodePoints(left.id, right.id));

  const toolDeclarations = await Promise.all(
    advertisedTools.map(async (tool): Promise<ModelToolDeclaration> => {
      const inputSchema = await resolveJsonSchema(tool.inputSchema);
      return canonicalize({
        id: tool.id,
        description: tool.description,
        inputSchema,
      }) as ModelToolDeclaration;
    }),
  );

  const canonicalTools = canonicalJson(toolDeclarations);
  const canonicalContent = canonicalJson({
    systemPrompt,
    toolDeclarations,
  });

  return {
    promptHash: hash('llame:model-context:prompt:v1', systemPrompt),
    toolHash: hash('llame:model-context:tools:v1', canonicalTools),
    contentHash: hash('llame:model-context:content:v1', canonicalContent),
    source: input.model.systemPromptSource,
    systemPrompt,
    toolDeclarations,
  };
}
