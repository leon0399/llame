import {
  canonicalJson,
  compareCodePoints,
  hashWithDomain,
} from '../canonical-json';
import { type ModelToolDeclaration } from '../db/schema';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { TOOL_REGISTRY } from '../tools/registry';
import {
  composeTurnToolCatalog,
  hashToolAvailabilityManifest,
  type TurnToolCandidate,
  type ToolAvailabilityManifestV1,
} from '../tools/turn-tool-catalog';
import { type Tool } from '../tools/types';

export { canonicalJson } from '../canonical-json';

/** Code-owned candidates when the caller doesn't supply pre-classified ones. */
function defaultCodeOwnedCandidates(
  candidates: Iterable<Tool> | undefined,
): Array<TurnToolCandidate> {
  return [...(candidates ?? TOOL_REGISTRY.values())].map((tool) => ({
    source: { type: 'code_owned' as const },
    state: 'available' as const,
    tool,
  }));
}

export type EffectiveContextSnapshotInput = {
  availabilityHash: string;
  contentHash: string;
  promptHash: string;
  toolHash: string;
  source: SystemModelCatalogEntry['systemPromptSource'];
  systemPrompt: string;
  toolAvailabilityManifest: ToolAvailabilityManifestV1;
  toolDeclarations: Array<ModelToolDeclaration>;
};

interface ResolveEffectiveContextInput {
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
  allowedToolRules: ReadonlyArray<string>;
  callTimeoutSeconds: number;
  candidates?: Iterable<Tool>;
  /** Owner-bound static candidates, including closed unavailable entries. */
  codeOwnedCandidates?: Iterable<TurnToolCandidate>;
  /** Synchronous source snapshots; shared allowlist and declaration admission still apply. */
  dynamicCandidates?: Iterable<TurnToolCandidate>;
}

export async function resolveEffectiveContext(
  input: ResolveEffectiveContextInput,
): Promise<EffectiveContextSnapshotInput> {
  const { systemPrompt } = input;
  const codeOwnedCandidates: Array<TurnToolCandidate> =
    input.codeOwnedCandidates
      ? [...input.codeOwnedCandidates]
      : defaultCodeOwnedCandidates(input.candidates);
  const catalog = await composeTurnToolCatalog({
    allowedToolRules: input.allowedToolRules,
    callTimeoutSeconds: input.callTimeoutSeconds,
    candidates: [...codeOwnedCandidates, ...(input.dynamicCandidates ?? [])],
  });
  const toolDeclarations = catalog.admitted
    .map(({ declaration }) => declaration)
    .sort((left, right) => compareCodePoints(left.id, right.id));

  const canonicalTools = canonicalJson(toolDeclarations);
  const canonicalContent = canonicalJson({
    systemPrompt,
    toolDeclarations,
  });

  return {
    availabilityHash: hashToolAvailabilityManifest(catalog.manifest),
    promptHash: hashWithDomain('llame:model-context:prompt:v1', systemPrompt),
    toolHash: hashWithDomain('llame:model-context:tools:v1', canonicalTools),
    contentHash: hashWithDomain(
      'llame:model-context:content:v1',
      canonicalContent,
    ),
    source: input.model.systemPromptSource,
    systemPrompt,
    toolAvailabilityManifest: catalog.manifest,
    toolDeclarations,
  };
}
