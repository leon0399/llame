import { canonicalize } from '@workspace/runtime-safety';
import { sanitizeAuthoredText } from '@workspace/runtime-safety';
import { admitToolInputSchema } from './schema-utils';
import { type JsonSchemaDocument } from './types';
import {
  PROTECTED_VALUE_REDACTION_MARKER,
  containsProtectedValueJson,
  isRecord,
  isString,
  normalizeProtectedValues,
  sanitizeProtectedValueJson,
} from '@workspace/runtime-safety';
import {
  createMcpToolId,
  findAsciiCaseFoldedCollisionIndexes,
} from './tool-id';


export const MCP_REDACTION_MARKER = PROTECTED_VALUE_REDACTION_MARKER;

export type AdmittedMcpToolDefinition = {
  readonly id: string;
  readonly remoteName: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaDocument;
};

export type McpDeclarationRefusalReason =
  | 'invalid_declaration'
  | 'invalid_tool_id'
  | 'invalid_schema'
  | 'unsupported_dialect'
  | 'protected_value'
  | 'name_collision';

export type McpDeclarationAdmissionResult = {
  readonly admitted: ReadonlyArray<AdmittedMcpToolDefinition>;
  readonly refused: ReadonlyArray<{
    readonly index: number;
    readonly id?: string;
    readonly reason: McpDeclarationRefusalReason;
  }>;
};

function safeRefusalId(
  serverId: string,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- validated by the compound guard `!isRecord(definition) || !isString(definition.name)` below -- two checks combined with `||`, a shape the structural exemption's single-check parse doesn't cover.
  definition: unknown,
  protectedValues: ReadonlyArray<string>,
): string | undefined {
  if (!isRecord(definition) || !isString(definition.name)) {
    return undefined;
  }
  if (containsProtectedValueJson(definition.name, protectedValues)) {
    return undefined;
  }
  const toolId = createMcpToolId(serverId, definition.name);
  if (!toolId.success) return undefined;
  return containsProtectedValueJson(toolId.id, protectedValues)
    ? undefined
    : toolId.id;
}

function sanitizeDescription(
  value: string,
  protectedValues: ReadonlyArray<string>,
): string {
  const redacted = sanitizeProtectedValueJson(value, protectedValues);
  if (!redacted.success || !isString(redacted.value)) {
    // A string leaf has no object key and the protected-value boundary always
    // returns a string. Keep this branch fail-closed if that contract changes.
    return MCP_REDACTION_MARKER;
  }
  return sanitizeAuthoredText(redacted.value);
}

type SafeValueResult = { success: true; value: unknown } | { success: false };

type SupportedSchemaDialect = 'draft-07' | '2019-09' | '2020-12';

const COMMON_SINGLE_SUBSCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  'additionalProperties',
  'contains',
  'else',
  'if',
  'not',
  'propertyNames',
  'then',
]);

const COMMON_SUBSCHEMA_ARRAY_KEYWORDS: ReadonlySet<string> = new Set([
  'allOf',
  'anyOf',
  'oneOf',
]);

const COMMON_SUBSCHEMA_MAP_KEYWORDS: ReadonlySet<string> = new Set([
  'definitions',
  'patternProperties',
  'properties',
]);

const MODERN_SINGLE_SUBSCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  'contentSchema',
  'unevaluatedItems',
  'unevaluatedProperties',
]);

const MODERN_SUBSCHEMA_MAP_KEYWORDS: ReadonlySet<string> = new Set([
  '$defs',
  'dependentSchemas',
]);

function resolveSupportedSchemaDialect(
  schema: JsonSchemaDocument,
): SupportedSchemaDialect | undefined {
  const declared = schema.$schema;
  if (!isString(declared)) return 'draft-07';
  const normalized = declared.endsWith('#') ? declared.slice(0, -1) : declared;
  switch (normalized) {
    case 'http://json-schema.org/draft-07/schema':
    case 'https://json-schema.org/draft-07/schema':
      return 'draft-07';
    case 'https://json-schema.org/draft/2019-09/schema':
      return '2019-09';
    case 'https://json-schema.org/draft/2020-12/schema':
      return '2020-12';
    default:
      return undefined;
  }
}

function safeInstanceValue(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- validated by the ternary test `containsProtectedValueJson(value, protectedValues)` below, which delegates to protected-values.ts's own recursive scanner over untrusted JSON; not an `isXxx`-named guard and the check is a ternary test, both shapes the structural exemption doesn't parse.
  value: unknown,
  protectedValues: ReadonlyArray<string>,
): SafeValueResult {
  return containsProtectedValueJson(value, protectedValues)
    ? { success: false }
    : { success: true, value };
}

function safeSubschemaArray(
  value: unknown,
  dialect: SupportedSchemaDialect,
  protectedValues: ReadonlyArray<string>,
): SafeValueResult {
  if (!Array.isArray(value)) {
    return safeInstanceValue(value, protectedValues);
  }
  const safe: Array<unknown> = [];
  for (const item of value) {
    const result = safeSchemaNode(item, dialect, protectedValues);
    if (!result.success) return result;
    safe.push(result.value);
  }
  return { success: true, value: safe };
}

function safeSubschemaMap(
  value: unknown,
  dialect: SupportedSchemaDialect,
  protectedValues: ReadonlyArray<string>,
): SafeValueResult {
  if (!isRecord(value)) {
    return safeInstanceValue(value, protectedValues);
  }
  const safeEntries: Array<[string, unknown]> = [];
  for (const [key, item] of Object.entries(value)) {
    if (containsProtectedValueJson(key, protectedValues)) {
      return { success: false };
    }
    const result = safeSchemaNode(item, dialect, protectedValues);
    if (!result.success) return result;
    safeEntries.push([key, result.value]);
  }
  return { success: true, value: Object.fromEntries(safeEntries) };
}

function safeDependencies(
  value: unknown,
  dialect: SupportedSchemaDialect,
  protectedValues: ReadonlyArray<string>,
): SafeValueResult {
  if (!isRecord(value)) {
    return safeInstanceValue(value, protectedValues);
  }
  const safeEntries: Array<[string, unknown]> = [];
  for (const [key, item] of Object.entries(value)) {
    if (containsProtectedValueJson(key, protectedValues)) {
      return { success: false };
    }
    const result = Array.isArray(item)
      ? safeInstanceValue(item, protectedValues)
      : safeSchemaNode(item, dialect, protectedValues);
    if (!result.success) return result;
    safeEntries.push([key, result.value]);
  }
  return { success: true, value: Object.fromEntries(safeEntries) };
}

/**
 * Dispatch ONE non-`description` schema-node keyword's value to its
 * dialect-aware handler — the JSON Schema keyword vocabulary (single
 * subschema, subschema array, subschema map, `dependencies`, `items`,
 * `additionalItems`, and the 2019-09+/2020-12 keyword extensions), falling
 * back to a leaf instance value for anything unrecognized. A direct
 * transcription of `safeSchemaNode`'s dispatch, kept separate from the
 * record iteration/accumulation around it.
 */
function safeSchemaKeywordValue(
  key: string,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- every branch below delegates `item` straight into a `safeXxx` helper (safeSchemaNode/safeSubschemaArray/safeSubschemaMap/safeDependencies/safeInstanceValue), each of which validates it via its own first-statement guard; this function's job is picking WHICH validator applies, not validating itself.
  item: unknown,
  dialect: SupportedSchemaDialect,
  protectedValues: ReadonlyArray<string>,
): SafeValueResult {
  if (COMMON_SINGLE_SUBSCHEMA_KEYWORDS.has(key)) {
    return safeSchemaNode(item, dialect, protectedValues);
  }
  if (COMMON_SUBSCHEMA_ARRAY_KEYWORDS.has(key)) {
    return safeSubschemaArray(item, dialect, protectedValues);
  }
  if (COMMON_SUBSCHEMA_MAP_KEYWORDS.has(key)) {
    return safeSubschemaMap(item, dialect, protectedValues);
  }
  if (key === 'dependencies') {
    return safeDependencies(item, dialect, protectedValues);
  }
  if (key === 'items') {
    return Array.isArray(item) && dialect !== '2020-12'
      ? safeSubschemaArray(item, dialect, protectedValues)
      : safeSchemaNode(item, dialect, protectedValues);
  }
  if (key === 'additionalItems' && dialect !== '2020-12') {
    return safeSchemaNode(item, dialect, protectedValues);
  }
  if (dialect !== 'draft-07' && MODERN_SINGLE_SUBSCHEMA_KEYWORDS.has(key)) {
    return safeSchemaNode(item, dialect, protectedValues);
  }
  if (dialect !== 'draft-07' && MODERN_SUBSCHEMA_MAP_KEYWORDS.has(key)) {
    return safeSubschemaMap(item, dialect, protectedValues);
  }
  if (dialect === '2020-12' && key === 'prefixItems') {
    return safeSubschemaArray(item, dialect, protectedValues);
  }
  return safeInstanceValue(item, protectedValues);
}

function safeSchemaNode(
  value: unknown,
  dialect: SupportedSchemaDialect,
  protectedValues: ReadonlyArray<string>,
): SafeValueResult {
  if (!isRecord(value)) return safeInstanceValue(value, protectedValues);

  const safeEntries: Array<[string, unknown]> = [];
  for (const [key, item] of Object.entries(value)) {
    if (containsProtectedValueJson(key, protectedValues)) {
      return { success: false };
    }
    if (key === 'description' && isString(item)) {
      safeEntries.push([key, sanitizeDescription(item, protectedValues)]);
      continue;
    }
    const result = safeSchemaKeywordValue(key, item, dialect, protectedValues);
    if (!result.success) return result;
    safeEntries.push([key, result.value]);
  }
  return { success: true, value: Object.fromEntries(safeEntries) };
}

/** The serverId/protectedValues/assertActive triple every per-definition
 *  admission step needs — call-wide, unchanged across a whole batch, as
 *  opposed to each definition's own `index`/`definition`. */
type AdmissionContext = {
  readonly serverId: string;
  readonly protectedValues: ReadonlyArray<string>;
  readonly assertActive: (() => void) | undefined;
};

type IdentityAdmission =
  | {
      readonly success: true;
      readonly name: string;
      readonly description: string | undefined;
      readonly inputSchema: JsonSchemaDocument;
      readonly toolId: string;
    }
  | { readonly success: false; readonly reason: McpDeclarationRefusalReason };

/**
 * The identity half of one declaration's admission: is it shaped like a tool
 * declaration, and does its name mint a safe, non-colliding-with-protected-
 * values tool id? Split out of `admitOneMcpToolDefinition` below — this is
 * "who is this declaration", independent of whether its schema is safe.
 * Synchronous, so relocating its two `assertActive` checkpoints here (instead
 * of interleaved in the caller) cannot change when cancellation is observed:
 * nothing here awaits, so no external event can land mid-execution.
 */
function admitDefinitionIdentity(
  serverId: string,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- validated by the compound guard `!isRecord(definition) || !isString(definition.name) || ... || !isRecord(definition.inputSchema)` below -- several checks combined with `||`, a shape the structural exemption's single-check parse doesn't cover.
  definition: unknown,
  protectedValues: ReadonlyArray<string>,
  assertActive: (() => void) | undefined,
): IdentityAdmission {
  if (
    !isRecord(definition) ||
    !isString(definition.name) ||
    (definition.description !== undefined &&
      !isString(definition.description)) ||
    !isRecord(definition.inputSchema)
  ) {
    return { success: false, reason: 'invalid_declaration' };
  }
  assertActive?.();
  if (containsProtectedValueJson(definition.name, protectedValues)) {
    return { success: false, reason: 'protected_value' };
  }

  const toolId = createMcpToolId(serverId, definition.name);
  if (!toolId.success) {
    return { success: false, reason: 'invalid_tool_id' };
  }
  if (containsProtectedValueJson(toolId.id, protectedValues)) {
    return { success: false, reason: 'protected_value' };
  }
  assertActive?.();
  return {
    success: true,
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    toolId: toolId.id,
  };
}

type SchemaAdmission =
  | { readonly success: true; readonly inputSchema: JsonSchemaDocument }
  | { readonly success: false; readonly reason: McpDeclarationRefusalReason };

/**
 * The schema half of one declaration's admission: resolve its dialect,
 * sanitize protected values through the schema tree, then compile/admit it.
 * Split out of `admitOneMcpToolDefinition` below — this is "is the schema
 * safe and valid", independent of the identity checks around it.
 */
async function admitDefinitionSchema(
  inputSchema: JsonSchemaDocument,
  protectedValues: ReadonlyArray<string>,
  assertActive: (() => void) | undefined,
): Promise<SchemaAdmission> {
  const dialect = resolveSupportedSchemaDialect(inputSchema);
  const safeSchema =
    dialect === undefined
      ? safeInstanceValue(inputSchema, protectedValues)
      : safeSchemaNode(inputSchema, dialect, protectedValues);
  assertActive?.();
  if (!safeSchema.success || !isRecord(safeSchema.value)) {
    return { success: false, reason: 'protected_value' };
  }
  assertActive?.();
  const schemaAdmission = await admitToolInputSchema(safeSchema.value);
  assertActive?.();
  if (!schemaAdmission.success) {
    return { success: false, reason: schemaAdmission.reason };
  }
  return {
    success: true,
    inputSchema: canonicalize(schemaAdmission.inputSchema),
  };
}

type OneDefinitionAdmission =
  | { readonly success: true; readonly tool: AdmittedMcpToolDefinition }
  | {
      readonly success: false;
      readonly refusal: {
        index: number;
        id?: string;
        reason: McpDeclarationRefusalReason;
      };
    };

function refusalAdmission(
  index: number,
  refusalId: string | undefined,
  reason: McpDeclarationRefusalReason,
): OneDefinitionAdmission {
  return {
    success: false,
    refusal: {
      index,
      ...(refusalId !== undefined && { id: refusalId }),
      reason,
    },
  };
}

/**
 * Admit or refuse ONE raw declaration — every check `admitMcpToolDefinitions`
 * ran inline per-definition, unchanged, just returning its verdict instead of
 * pushing into a shared `refused` array and `continue`-ing a shared loop.
 */
async function admitOneMcpToolDefinition(
  index: number,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- this function's first use of `definition` is a bare-identifier delegation into `safeRefusalId`/`admitDefinitionIdentity`, which validate it via their own guards; not itself a validating check.
  definition: unknown,
  context: AdmissionContext,
): Promise<OneDefinitionAdmission> {
  const { serverId, protectedValues, assertActive } = context;
  assertActive?.();
  const refusalId = safeRefusalId(serverId, definition, protectedValues);

  const identity = admitDefinitionIdentity(
    serverId,
    definition,
    protectedValues,
    assertActive,
  );
  if (!identity.success) {
    return refusalAdmission(index, refusalId, identity.reason);
  }

  const schemaAdmission = await admitDefinitionSchema(
    identity.inputSchema,
    protectedValues,
    assertActive,
  );
  if (!schemaAdmission.success) {
    return refusalAdmission(index, refusalId, schemaAdmission.reason);
  }

  assertActive?.();
  const tool = {
    id: identity.toolId,
    remoteName: identity.name,
    description: sanitizeDescription(
      identity.description ?? '',
      protectedValues,
    ),
    inputSchema: schemaAdmission.inputSchema,
  };
  assertActive?.();
  return { success: true, tool };
}

/**
 * The cross-definition half of admission, run once the whole batch's
 * individually-valid tools are known: fold any ASCII-case-folded name
 * collision into a refusal (mutating the shared `refused` array, matching
 * `admitMcpToolDefinitions`'s own accumulation style) and return the rest as
 * admitted, in provisional order.
 */
function resolveNameCollisions(
  provisional: ReadonlyArray<{
    readonly index: number;
    readonly tool: AdmittedMcpToolDefinition;
  }>,
  refused: Array<{
    index: number;
    id?: string;
    reason: McpDeclarationRefusalReason;
  }>,
  assertActive: (() => void) | undefined,
): Array<AdmittedMcpToolDefinition> {
  assertActive?.();
  const collisionIndexes = findAsciiCaseFoldedCollisionIndexes(
    provisional.map(({ tool }) => tool.id),
  );
  assertActive?.();
  const admitted: Array<AdmittedMcpToolDefinition> = [];
  for (const [provisionalIndex, { index, tool }] of provisional.entries()) {
    assertActive?.();
    if (collisionIndexes.has(provisionalIndex)) {
      refused.push({ index, id: tool.id, reason: 'name_collision' });
    } else {
      admitted.push(tool);
    }
  }
  return admitted;
}

export async function admitMcpToolDefinitions(input: {
  readonly serverId: string;
  readonly protectedValues: ReadonlyArray<string>;
  readonly definitions: ReadonlyArray<unknown>;
  readonly assertActive?: () => void;
}): Promise<McpDeclarationAdmissionResult> {
  const protectedValues = normalizeProtectedValues(input.protectedValues);
  const context: AdmissionContext = {
    serverId: input.serverId,
    protectedValues,
    assertActive: input.assertActive,
  };
  const provisional: Array<{
    readonly index: number;
    readonly tool: AdmittedMcpToolDefinition;
  }> = [];
  const refused: Array<{
    index: number;
    id?: string;
    reason: McpDeclarationRefusalReason;
  }> = [];

  for (const [index, definition] of input.definitions.entries()) {
    const result = await admitOneMcpToolDefinition(index, definition, context);
    if (result.success) {
      provisional.push({ index, tool: result.tool });
    } else {
      refused.push(result.refusal);
    }
  }

  const admitted = resolveNameCollisions(
    provisional,
    refused,
    input.assertActive,
  );
  input.assertActive?.();
  refused.sort((left, right) => left.index - right.index);
  input.assertActive?.();

  return { admitted, refused };
}
