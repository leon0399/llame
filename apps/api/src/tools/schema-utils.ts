/**
 * Schema utilities for tools that may declare their input schema as either
 * Zod (code-authored) or JSON Schema (external sources, #214 D2/D3).
 */

import Ajv from 'ajv';
import Ajv2019 from 'ajv/dist/2019';
import Ajv2020 from 'ajv/dist/2020';
import { type FlexibleSchema, asSchema, jsonSchema } from 'ai';
import { type z } from 'zod';

import { type JsonSchemaDocument } from './types';

function isZodSchema(
  schema: z.ZodTypeAny | JsonSchemaDocument,
): schema is z.ZodTypeAny {
  return typeof (schema as z.ZodTypeAny).safeParse === 'function';
}

const DIALECT_CONSTRUCTORS: Record<string, typeof Ajv> = {
  'http://json-schema.org/draft-07/schema#': Ajv,
  'https://json-schema.org/draft/2019-09/schema': Ajv2019,
  'https://json-schema.org/draft/2020-12/schema': Ajv2020,
};

function resolveAjvConstructor(
  doc: JsonSchemaDocument,
): typeof Ajv | undefined {
  const dialect = doc.$schema;
  if (typeof dialect !== 'string') return Ajv;
  return DIALECT_CONSTRUCTORS[dialect];
}

/**
 * Build an ajv-backed validate function for a JSON Schema document, selecting
 * the constructor matching the schema's declared dialect (D3).
 *
 * Returns undefined when no validator is available for the declared dialect —
 * that tool should be refused at registration, not silently unvalidated.
 */
export function buildJsonSchemaValidator(
  doc: JsonSchemaDocument,
):
  | ((
      value: unknown,
    ) => { success: true; value: unknown } | { success: false; error: Error })
  | undefined {
  const AjvCtor = resolveAjvConstructor(doc);
  if (!AjvCtor) return undefined;

  let validate: import('ajv').ValidateFunction;
  try {
    const ajv = new AjvCtor({ allErrors: true, strict: false });
    validate = ajv.compile(doc);
  } catch {
    return undefined;
  }

  return (value: unknown) => {
    if (validate(value)) {
      return { success: true, value };
    }
    const message =
      validate.errors?.map((e) => e.message).join('; ') ?? 'validation failed';
    return { success: false, error: new Error(message) };
  };
}

/**
 * Convert a tool's inputSchema (Zod or JSON Schema) into the SDK's
 * FlexibleSchema for use with `tool()`. For JSON Schema tools, this
 * supplies an ajv-backed validate so the SDK's tool-call parsing actually
 * checks arguments (D3: safeValidateTypes passes everything without one).
 *
 * Returns null when the schema declares a dialect no available validator
 * supports — the tool should be refused at registration.
 */
export function toFlexibleSchema(
  schema: z.ZodTypeAny | JsonSchemaDocument,
): FlexibleSchema<unknown> | null {
  if (isZodSchema(schema)) {
    return asSchema(schema) as FlexibleSchema<unknown>;
  }
  const validator = buildJsonSchemaValidator(schema);
  if (!validator) return null;
  return jsonSchema(schema, { validate: validator }) as FlexibleSchema<unknown>;
}

/**
 * Defense-in-depth argument validation for callers that bypass the SDK
 * (runner.ts). Handles both Zod schemas (`.safeParse`) and JSON Schema
 * documents (ajv-backed). Task 3.3: keep the existing check, widened.
 */
export function safeParseArgs(
  schema: z.ZodTypeAny | JsonSchemaDocument,
  args: unknown,
): { success: true; data: unknown } | { success: false } {
  if (isZodSchema(schema)) {
    const result = schema.safeParse(args);
    return result.success
      ? { success: true, data: result.data }
      : { success: false };
  }
  const validator = buildJsonSchemaValidator(schema);
  if (!validator) return { success: false };
  const result = validator(args);
  return result.success
    ? { success: true, data: result.value }
    : { success: false };
}

/**
 * Resolve a tool's input schema to its JSON Schema representation for
 * snapshotting. The SDK's `asSchema` handles Zod; JSON Schema documents
 * are already in the target form.
 */
export async function resolveJsonSchema(
  schema: z.ZodTypeAny | JsonSchemaDocument,
): Promise<Record<string, unknown>> {
  if (isZodSchema(schema)) {
    return (await asSchema(schema).jsonSchema) as Record<string, unknown>;
  }
  return schema;
}
