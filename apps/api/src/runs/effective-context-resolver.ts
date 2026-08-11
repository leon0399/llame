import {
  canonicalJson,
  canonicalize,
  compareCodePoints,
  hashWithDomain,
} from '../canonical-json';
import { Logger } from '@nestjs/common';
import { type ModelToolDeclaration } from '../db/schema';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { resolveAdvertisedTools } from '../tools/registry';
import { admitToolInputSchema } from '../tools/schema-utils';
import { type Tool } from '../tools/types';

export { canonicalJson } from '../canonical-json';

const logger = new Logger('EffectiveContextResolver');

export type EffectiveContextSnapshotInput = {
  contentHash: string;
  promptHash: string;
  toolHash: string;
  source: SystemModelCatalogEntry['systemPromptSource'];
  systemPrompt: string;
  toolDeclarations: ModelToolDeclaration[];
};

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

  const toolDeclarations: ModelToolDeclaration[] = [];
  for (const tool of advertisedTools) {
    const admission = await admitToolInputSchema(tool.inputSchema);
    if (!admission.success) {
      logger.warn(
        `Refusing tool "${tool.id}": ${admission.reason.replace('_', ' ')} for dialect "${admission.dialect}": ${admission.message}.`,
      );
      continue;
    }
    toolDeclarations.push(
      canonicalize({
        id: tool.id,
        description: tool.description,
        inputSchema: admission.inputSchema,
      }) as ModelToolDeclaration,
    );
  }

  const canonicalTools = canonicalJson(toolDeclarations);
  const canonicalContent = canonicalJson({
    systemPrompt,
    toolDeclarations,
  });

  return {
    promptHash: hashWithDomain('llame:model-context:prompt:v1', systemPrompt),
    toolHash: hashWithDomain('llame:model-context:tools:v1', canonicalTools),
    contentHash: hashWithDomain(
      'llame:model-context:content:v1',
      canonicalContent,
    ),
    source: input.model.systemPromptSource,
    systemPrompt,
    toolDeclarations,
  };
}
