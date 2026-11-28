import { z } from 'zod';

import { loadPackagedTemplate } from '../prompts/template-engine';
import { type JsonSchemaDocument } from './types';

// Executor and MCP schemas remain unchanged, including tools with their own i.
const INTENT_TOOLS = new Set([
  'bash',
  'read',
  'edit',
  'write',
  'grep',
  'wait',
  'stop',
  'enter_workspace',
  'search_conversations',
  'knowledge_search',
  'web_search',
]);

const intent = z.string().trim().min(1).max(120);
const argumentsSchema = z.record(z.string(), z.unknown());
const requiredFields = z.array(z.string());

const intentDescription = loadPackagedTemplate<Record<string, never>>(
  __dirname,
  'tool-intent',
)({});

type ToolEnvelope = { input: unknown; intent?: string };

/** The model-facing envelope; never used to authorize or execute a call. */
export function withToolIntent(
  id: string,
  schema: JsonSchemaDocument,
): JsonSchemaDocument {
  if (!INTENT_TOOLS.has(id)) return schema;
  const properties = argumentsSchema.safeParse(schema.properties).data ?? {};
  const required = requiredFields.safeParse(schema.required).data ?? [];

  return {
    ...schema,
    properties: {
      i: {
        type: 'string',
        minLength: 1,
        maxLength: 120,
        pattern: '\\S',
        description: intentDescription,
      },
      ...properties,
    },
    required: [...required, 'i'],
  };
}

/** Removes the display envelope before ordinary validation and admission. */
export function splitToolIntent(id: string, input: unknown): ToolEnvelope {
  const parsed = argumentsSchema.safeParse(input);

  if (
    !INTENT_TOOLS.has(id) ||
    !parsed.success ||
    !Object.hasOwn(parsed.data, 'i')
  )
    return { input };
  const { i, ...args } = parsed.data;
  const value = intent.safeParse(i);

  return { input: args, ...(value.success && { intent: value.data }) };
}
