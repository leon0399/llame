import { compareCodePoints, hashWithDomain } from '../canonical-json';
import { type ModelToolDeclaration } from '../db/schema';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { TOOL_REGISTRY } from '../tools/registry';
import {
  composeTurnToolCatalog,
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

/**
 * Everything one prepared attempt holds in memory: the immutable
 * system-prompt receipt that is persisted, plus the admitted declarations and
 * availability manifest that never reach storage.
 */
export type ResolvedAttemptContext = SystemPromptReceiptInput & {
  toolAvailabilityManifest: ToolAvailabilityManifestV1;
  toolDeclarations: Array<ModelToolDeclaration>;
};

interface ResolveEffectiveContextInput {
  model: SystemModelCatalogEntry;
  /**
   * The prompt exactly as it will be sent, already rendered with the owner's
   * per-user context by `SystemPromptsService`.
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

export type SystemPromptReceiptInput = {
  promptHash: string;
  source: SystemModelCatalogEntry['systemPromptSource'];
  systemPrompt: string;
};

export async function resolveEffectiveContext(
  input: ResolveEffectiveContextInput,
): Promise<ResolvedAttemptContext> {
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
  return {
    promptHash: hashWithDomain('llame:model-context:prompt:v1', systemPrompt),
    source: input.model.systemPromptSource,
    systemPrompt,
    toolAvailabilityManifest: catalog.manifest,
    toolDeclarations,
  };
}
