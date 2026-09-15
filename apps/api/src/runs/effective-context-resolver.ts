import { compareCodePoints, hashWithDomain } from '../canonical-json';
import { type ModelToolDeclaration } from '../db/schema';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { TOOL_REGISTRY } from '../tools/registry';
import {
  composeTurnToolCatalog,
  type ToolAvailabilityManifestV1,
  type ToolDescriptionRenderer,
  type TurnToolCandidate,
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

/** The admitted attempt catalog, shared by both prompt surfaces. */
export type AttemptToolCatalog = {
  availabilityManifest: ToolAvailabilityManifestV1;
  declarations: Array<ModelToolDeclaration>;
  /** Admitted ids, sorted — the membership set `tools.<id>` predicates test. */
  admittedIds: Array<string>;
};
export type ComposeAttemptToolCatalogInput = {
  allowedToolRules: ReadonlyArray<string>;
  callTimeoutSeconds: number;
  candidates?: Iterable<Tool>;
  /** Owner-bound static candidates, including closed unavailable entries. */
  codeOwnedCandidates?: Iterable<TurnToolCandidate>;
  /** Synchronous source snapshots; shared allowlist and declaration admission still apply. */
  dynamicCandidates?: Iterable<TurnToolCandidate>;
  /**
   * Render admitted code-owned descriptions after the complete membership set
   * is known. Opaque MCP descriptions are passed through unchanged by the
   * caller's renderer.
   */
  descriptionRenderer?: ToolDescriptionRenderer;
};

/**
 * Admit this attempt's tool catalog. Runs BEFORE either prompt surface is
 * rendered, so a description template's `tools.<id>` predicate and the
 * system prompt observe the same membership.
 */
export async function composeAttemptToolCatalog(
  input: ComposeAttemptToolCatalogInput,
): Promise<AttemptToolCatalog> {
  const codeOwnedCandidates: Array<TurnToolCandidate> =
    input.codeOwnedCandidates
      ? [...input.codeOwnedCandidates]
      : defaultCodeOwnedCandidates(input.candidates);
  const catalog = await composeTurnToolCatalog({
    allowedToolRules: input.allowedToolRules,
    callTimeoutSeconds: input.callTimeoutSeconds,
    candidates: [...codeOwnedCandidates, ...(input.dynamicCandidates ?? [])],
    descriptionRenderer: input.descriptionRenderer,
  });
  const declarations = catalog.admitted
    .map(({ declaration }) => declaration)
    .sort((left, right) => compareCodePoints(left.id, right.id));
  return {
    availabilityManifest: catalog.manifest,
    declarations,
    admittedIds: declarations.map(({ id }) => id),
  };
}

interface ResolveEffectiveContextInput extends ComposeAttemptToolCatalogInput {
  model: SystemModelCatalogEntry;
  /**
   * The prompt exactly as it will be sent, already rendered with the owner's
   * per-user context by `SystemPromptsService`.
   */
  systemPrompt: string;
  /**
   * A catalog already admitted by `composeAttemptToolCatalog`. Supplied when
   * the prompt was rendered from that same membership; omitted (and then
   * composed here) for callers that need a standalone receipt input.
   */
  catalog?: AttemptToolCatalog;
}

export type SystemPromptReceiptInput = {
  promptHash: string;
  source: SystemModelCatalogEntry['systemPromptSource'];
  systemPrompt: string;
};

export async function resolveEffectiveContext(
  input: ResolveEffectiveContextInput,
): Promise<SystemPromptReceiptInput> {
  const catalog = input.catalog ?? (await composeAttemptToolCatalog(input));
  return finalizeEffectiveContext({
    model: input.model,
    systemPrompt: input.systemPrompt,
    catalog,
  });
}

/**
 * Build the immutable receipt payload for one already-admitted attempt.
 * Catalog declarations and availability stay in the worker's attempt memory.
 */
export function finalizeEffectiveContext(input: {
  model: SystemModelCatalogEntry;
  systemPrompt: string;
  catalog: AttemptToolCatalog;
}): SystemPromptReceiptInput {
  return {
    promptHash: hashWithDomain(
      'llame:model-context:prompt:v1',
      input.systemPrompt,
    ),
    source: input.model.systemPromptSource,
    systemPrompt: input.systemPrompt,
  };
}
