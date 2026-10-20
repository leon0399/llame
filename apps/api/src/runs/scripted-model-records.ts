/**
 * What the scripted model client records about the provider requests it
 * served: the calls it made, the prompts they carried, and the declarations
 * they offered. Split out of `scripted-model-client.ts` so that file stays
 * under the size trip-wire on its own; the recorder and the readers that
 * assert on it are the same concern.
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FunctionTool,
  LanguageModelV3ProviderTool,
} from '@ai-sdk/provider';

import type { ModelStreamInput } from '../models/model-client';

/**
 * One recorded stream call: the model that served it, plus the two input facts
 * a test asserts on — the effort sent and the Chat identity the run derived.
 */
export interface StreamCallRecord {
  modelId: string;
  effort: ModelStreamInput['effort'];
  chat: ModelStreamInput['chat'];
}

/** One declaration the request carried: the id the model calls and its description. */
export type DeclarationRecord = {
  readonly toolId: string;
  readonly description: string;
};

/** The declarations one request carried, keyed by the model that served it. */
export type ToolDeclarationRecord = {
  readonly modelId: string;
  readonly tools: ReadonlyArray<DeclarationRecord>;
};

/**
 * The record an executing client appends to, shared with the owning
 * `ScriptedModelsService` so a test can assert what execution actually
 * requested and which provider prompts it sent.
 */
export type ScriptedModelRecords = {
  streamCalls: Array<StreamCallRecord>;
  prompts: Array<LanguageModelV3CallOptions['prompt']>;
  declarations: Array<ToolDeclarationRecord>;
};

/**
 * Every declaration one provider request carried, id and description, in the
 * order the request holds them. Declarations are not part of the provider
 * prompt, so this is the only way a test can see what a Run's model was
 * offered — including a dynamic declaration a Workspace MCP server contributed
 * after the entry step.
 */
export function providerDeclarations(
  tools:
    | ReadonlyArray<LanguageModelV3FunctionTool | LanguageModelV3ProviderTool>
    | undefined,
): ReadonlyArray<DeclarationRecord> {
  return (tools ?? []).map((tool) => ({
    toolId: tool.name,
    description: tool.type === 'function' ? (tool.description ?? '') : '',
  }));
}
