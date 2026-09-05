/**
 * Schema utilities for tools that may declare their input schema as either
 * Zod (code-authored) or JSON Schema (external sources, #214 D2/D3).
 */

import Ajv from 'ajv';
import Ajv2019 from 'ajv/dist/2019';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { type FlexibleSchema, asSchema, jsonSchema } from 'ai';
import { type z } from 'zod';

import { type JsonSchemaDocument } from './types';
import { isRecord, isString } from '@workspace/runtime-safety';

export function isZodSchema(
  schema: z.ZodTypeAny | JsonSchemaDocument,
): schema is z.ZodTypeAny {
  if (
    schema === null ||
    typeof schema !== 'object' ||
    !('safeParse' in schema)
  ) {
    return false;
  }

  return typeof schema.safeParse === 'function';
}

const DIALECT_CONSTRUCTORS = new Map<string, typeof Ajv>([
  ['http://json-schema.org/draft-07/schema', Ajv],
  ['https://json-schema.org/draft-07/schema', Ajv],
  ['https://json-schema.org/draft/2019-09/schema', Ajv2019],
  ['https://json-schema.org/draft/2020-12/schema', Ajv2020],
]);

type JsonSchemaValidator = (
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- type of the compiled schema-validator function itself (see the implementation at `compileJsonSchemaValidator`'s `validate:` below, which runs `validate(value)` against the ajv-compiled schema as its own first use); a type declaration has no body for the structural exemption to inspect.
  value: unknown,
) => { success: true; value: unknown } | { success: false; error: Error };

export type JsonSchemaCompilation =
  | { success: true; validate: JsonSchemaValidator }
  | {
      success: false;
      reason: 'unsupported_dialect' | 'invalid_schema';
      dialect: string;
      message: string;
    };

function normalizedDialectUri(dialect: string): string {
  return dialect.endsWith('#') ? dialect.slice(0, -1) : dialect;
}

function schemaDialect(doc: JsonSchemaDocument): string {
  return isString(doc.$schema) ? doc.$schema : 'draft-07 (default)';
}

function resolveAjvConstructor(
  doc: JsonSchemaDocument,
): typeof Ajv | undefined {
  const dialect = doc.$schema;
  if (!isString(dialect)) return Ajv;
  return DIALECT_CONSTRUCTORS.get(normalizedDialectUri(dialect));
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- validated by the compound guard `!isString(dialect) || normalizedDialectUri(dialect) !== '...'` below -- a type-guard call combined with a derived comparison via `||`, a shape the structural exemption's single-check parse doesn't cover.
function addDraft07HttpsMetaSchemaAlias(ajv: Ajv, dialect: unknown): void {
  if (
    !isString(dialect) ||
    normalizedDialectUri(dialect) !== 'https://json-schema.org/draft-07/schema'
  ) {
    return;
  }

  const draft07MetaSchema = ajv.getSchema(
    'http://json-schema.org/draft-07/schema',
  )?.schema;
  if (!isRecord(draft07MetaSchema)) {
    throw new Error('draft-07 meta-schema is unavailable');
  }
  ajv.addMetaSchema({
    ...draft07MetaSchema,
    $id: 'https://json-schema.org/draft-07/schema',
  });
}

/**
 * Build an ajv-backed validate function for a JSON Schema document, selecting
 * the constructor matching the schema's declared dialect (D3).
 *
 * Returns a diagnostic result so callers admitting a catalog can refuse only
 * the affected tool while naming its dialect and failure mode.
 */
export function compileJsonSchemaValidator(
  doc: JsonSchemaDocument,
): JsonSchemaCompilation {
  const dialect = schemaDialect(doc);
  const AjvCtor = resolveAjvConstructor(doc);
  if (!AjvCtor) {
    return {
      success: false,
      reason: 'unsupported_dialect',
      dialect,
      message: `no validator is available for dialect "${dialect}"`,
    };
  }

  let validate: import('ajv').ValidateFunction;
  try {
    const ajv = new AjvCtor({ allErrors: true, strict: false });
    addDraft07HttpsMetaSchemaAlias(ajv, doc.$schema);
    addFormats(ajv);
    validate = ajv.compile(doc);
  } catch (error) {
    return {
      success: false,
      reason: 'invalid_schema',
      dialect,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    success: true,
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- first use is `if (validate(value))` immediately below -- `validate` is the ajv-compiled `ValidateFunction` (this closure's outer `validate`), the actual real-time schema check; a bare identifier named `validate` rather than `isXxx`- or `.parse`/`.safeParse`-shaped, outside the structural exemption's naming coverage.
    validate: (value: unknown) => {
      if (validate(value)) {
        return { success: true, value };
      }
      const message =
        validate.errors?.map((e) => e.message).join('; ') ??
        'validation failed';
      return { success: false, error: new Error(message) };
    },
  };
}

/** Compatibility wrapper for validation call sites that need only yes/no. */
export function buildJsonSchemaValidator(
  doc: JsonSchemaDocument,
): JsonSchemaValidator | undefined {
  const compilation = compileJsonSchemaValidator(doc);
  return compilation.success ? compilation.validate : undefined;
}

export type ToolSchemaAdmission =
  | { success: true; inputSchema: JsonSchemaDocument }
  | Extract<JsonSchemaCompilation, { success: false }>;

/**
 * Compile and resolve one declaration before it enters an immutable snapshot.
 * A JSON Schema is returned exactly as supplied; dialect normalization is
 * limited to validator lookup and never mutates or rewrites `$schema`.
 */
export async function admitToolInputSchema(
  schema: z.ZodTypeAny | JsonSchemaDocument,
): Promise<ToolSchemaAdmission> {
  if (isZodSchema(schema)) {
    const generatedSchema = await asSchema(schema).jsonSchema;
    return {
      success: true,
      inputSchema: { ...generatedSchema },
    };
  }

  const compilation = compileJsonSchemaValidator(schema);
  return compilation.success
    ? { success: true, inputSchema: schema }
    : compilation;
}

/**
 * Convert a tool's inputSchema (Zod or JSON Schema) into the SDK's
 * FlexibleSchema for use with `tool()`. For JSON Schema tools, this
 * supplies an ajv-backed validate so the SDK's tool-call parsing actually
 * checks arguments (D3: safeValidateTypes passes everything without one).
 *
 * Returns null when the declared dialect is unsupported or the schema cannot
 * compile — the tool must remain unavailable rather than run unvalidated.
 */
export function toFlexibleSchema(
  schema: z.ZodTypeAny | JsonSchemaDocument,
): FlexibleSchema<unknown> | null {
  if (isZodSchema(schema)) {
    // SAFETY: schema is the umbrella z.ZodTypeAny, so asSchema<OBJECT>'s
    // OBJECT type parameter can't infer this function's own `unknown`
    // contract; this erases it to match toFlexibleSchema's declared return.
    return asSchema(schema) as FlexibleSchema<unknown>;
  }
  const validator = buildJsonSchemaValidator(schema);
  if (!validator) return null;
  // SAFETY: jsonSchema<OBJECT>'s OBJECT type parameter defaults to unknown
  // when uninferred here, matching toFlexibleSchema's declared return, but
  // Schema<unknown> and FlexibleSchema<unknown> still need this assertion to
  // line up structurally.
  return jsonSchema(schema, { validate: validator }) as FlexibleSchema<unknown>;
}

/**
 * Defense-in-depth argument validation for callers that bypass the SDK
 * (runner.ts). Handles both Zod schemas (`.safeParse`) and JSON Schema
 * documents (ajv-backed). Task 3.3: keep the existing check, widened.
 */
export function safeParseArgs(
  schema: z.ZodTypeAny | JsonSchemaDocument,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- this whole function's body IS `args`'s validation (see the doc comment above: "Defense-in-depth argument validation"), dispatching through `schema.safeParse(args)` or the ajv validator depending on schema kind; the first statement checks `schema`'s type, not `args` directly, so the structural exemption doesn't fire even though this function is definitionally `args`'s validator.
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
): Promise<JsonSchemaDocument> {
  if (isZodSchema(schema)) {
    const generatedSchema = await asSchema(schema).jsonSchema;
    return { ...generatedSchema };
  }
  return schema;
}
