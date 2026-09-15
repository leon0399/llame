import { pgEnum } from 'drizzle-orm/pg-core';

import { type JsonSchemaDocument } from '../../tools/types';

export type ModelToolDeclaration = {
  id: string;
  description: string;
  inputSchema: JsonSchemaDocument;
};

export const modelContextPromptSource = pgEnum('model_context_prompt_source', [
  'project_default',
  'model_override',
]);

/**
 * Minimal availability record per successfully committed turn: sorted tool
 * ids and their available/unavailable state. Contains no schema, description,
 * template, hash, endpoint, or failure detail.
 *
 * Written only in successful-turn finalization, not during claim or receipt
 * preparation. Empty observed state is `[]`; absence means no committed
 * observation. Owner-scoped via the run's chat ownership.
 */
export type TurnToolAvailabilityEntry = {
  id: string;
  state: 'available' | 'unavailable';
};
