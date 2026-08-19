import { canonicalize } from '../canonical-json';
import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { admitToolInputSchema } from '../tools/schema-utils';
import { type JsonSchemaDocument } from '../tools/types';
import { isRecord } from '../unknown-record';
import {
  createMcpToolId,
  findAsciiCaseFoldedCollisionIndexes,
} from './tool-id';
import {
  PROTECTED_VALUE_REDACTION_MARKER,
  containsProtectedValueJson,
  normalizeProtectedValues,
  sanitizeProtectedValueJson,
} from './protected-values';

export const MCP_REDACTION_MARKER = PROTECTED_VALUE_REDACTION_MARKER;

export type RawMcpToolDefinition = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonSchemaDocument;
};

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
  readonly admitted: readonly AdmittedMcpToolDefinition[];
  readonly refused: readonly {
    readonly index: number;
    readonly id?: string;
    readonly reason: McpDeclarationRefusalReason;
  }[];
};

function safeRefusalId(
  serverId: string,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- validated by the compound guard `!isRecord(definition) || typeof definition.name !== 'string'` below -- two checks combined with `||`, a shape the structural exemption's single-check parse doesn't cover.
  definition: unknown,
  protectedValues: readonly string[],
): string | undefined {
  if (!isRecord(definition) || typeof definition.name !== 'string') {
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
  protectedValues: readonly string[],
): string {
  const redacted = sanitizeProtectedValueJson(value, protectedValues);
  if (!redacted.success || typeof redacted.value !== 'string') {
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
  if (typeof declared !== 'string') return 'draft-07';
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
  protectedValues: readonly string[],
): SafeValueResult {
  return containsProtectedValueJson(value, protectedValues)
    ? { success: false }
    : { success: true, value };
}

function safeSubschemaArray(
  value: unknown,
  dialect: SupportedSchemaDialect,
  protectedValues: readonly string[],
): SafeValueResult {
  if (!Array.isArray(value)) {
    return safeInstanceValue(value, protectedValues);
  }
  const safe: unknown[] = [];
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
  protectedValues: readonly string[],
): SafeValueResult {
  if (!isRecord(value)) {
    return safeInstanceValue(value, protectedValues);
  }
  const safeEntries: [string, unknown][] = [];
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
  protectedValues: readonly string[],
): SafeValueResult {
  if (!isRecord(value)) {
    return safeInstanceValue(value, protectedValues);
  }
  const safeEntries: [string, unknown][] = [];
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

function safeSchemaNode(
  value: unknown,
  dialect: SupportedSchemaDialect,
  protectedValues: readonly string[],
): SafeValueResult {
  if (!isRecord(value)) return safeInstanceValue(value, protectedValues);

  const safeEntries: [string, unknown][] = [];
  for (const [key, item] of Object.entries(value)) {
    if (containsProtectedValueJson(key, protectedValues)) {
      return { success: false };
    }
    if (key === 'description' && typeof item === 'string') {
      safeEntries.push([key, sanitizeDescription(item, protectedValues)]);
      continue;
    }

    let result: SafeValueResult;
    if (COMMON_SINGLE_SUBSCHEMA_KEYWORDS.has(key)) {
      result = safeSchemaNode(item, dialect, protectedValues);
    } else if (COMMON_SUBSCHEMA_ARRAY_KEYWORDS.has(key)) {
      result = safeSubschemaArray(item, dialect, protectedValues);
    } else if (COMMON_SUBSCHEMA_MAP_KEYWORDS.has(key)) {
      result = safeSubschemaMap(item, dialect, protectedValues);
    } else if (key === 'dependencies') {
      result = safeDependencies(item, dialect, protectedValues);
    } else if (key === 'items') {
      result =
        Array.isArray(item) && dialect !== '2020-12'
          ? safeSubschemaArray(item, dialect, protectedValues)
          : safeSchemaNode(item, dialect, protectedValues);
    } else if (key === 'additionalItems' && dialect !== '2020-12') {
      result = safeSchemaNode(item, dialect, protectedValues);
    } else if (
      dialect !== 'draft-07' &&
      MODERN_SINGLE_SUBSCHEMA_KEYWORDS.has(key)
    ) {
      result = safeSchemaNode(item, dialect, protectedValues);
    } else if (
      dialect !== 'draft-07' &&
      MODERN_SUBSCHEMA_MAP_KEYWORDS.has(key)
    ) {
      result = safeSubschemaMap(item, dialect, protectedValues);
    } else if (dialect === '2020-12' && key === 'prefixItems') {
      result = safeSubschemaArray(item, dialect, protectedValues);
    } else {
      result = safeInstanceValue(item, protectedValues);
    }
    if (!result.success) return result;
    safeEntries.push([key, result.value]);
  }
  return { success: true, value: Object.fromEntries(safeEntries) };
}

export async function admitMcpToolDefinitions(input: {
  readonly serverId: string;
  readonly protectedValues: readonly string[];
  readonly definitions: readonly unknown[];
  readonly assertActive?: () => void;
}): Promise<McpDeclarationAdmissionResult> {
  const protectedValues = normalizeProtectedValues(input.protectedValues);
  const provisional: {
    readonly index: number;
    readonly tool: AdmittedMcpToolDefinition;
  }[] = [];
  const refused: {
    index: number;
    id?: string;
    reason: McpDeclarationRefusalReason;
  }[] = [];

  for (const [index, definition] of input.definitions.entries()) {
    input.assertActive?.();
    const refusalId = safeRefusalId(
      input.serverId,
      definition,
      protectedValues,
    );
    const refuse = (reason: McpDeclarationRefusalReason): void => {
      refused.push({
        index,
        ...(refusalId !== undefined && { id: refusalId }),
        reason,
      });
    };
    if (
      !isRecord(definition) ||
      typeof definition.name !== 'string' ||
      (definition.description !== undefined &&
        typeof definition.description !== 'string') ||
      !isRecord(definition.inputSchema)
    ) {
      refuse('invalid_declaration');
      continue;
    }
    input.assertActive?.();
    if (containsProtectedValueJson(definition.name, protectedValues)) {
      refuse('protected_value');
      continue;
    }

    const toolId = createMcpToolId(input.serverId, definition.name);
    if (!toolId.success) {
      refuse('invalid_tool_id');
      continue;
    }
    if (containsProtectedValueJson(toolId.id, protectedValues)) {
      refuse('protected_value');
      continue;
    }
    input.assertActive?.();

    const dialect = resolveSupportedSchemaDialect(definition.inputSchema);
    const safeSchema =
      dialect === undefined
        ? safeInstanceValue(definition.inputSchema, protectedValues)
        : safeSchemaNode(definition.inputSchema, dialect, protectedValues);
    input.assertActive?.();
    if (!safeSchema.success || !isRecord(safeSchema.value)) {
      refuse('protected_value');
      continue;
    }
    input.assertActive?.();
    const schemaAdmission = await admitToolInputSchema(safeSchema.value);
    input.assertActive?.();
    if (!schemaAdmission.success) {
      refuse(schemaAdmission.reason);
      continue;
    }

    input.assertActive?.();
    const tool = {
      id: toolId.id,
      remoteName: definition.name,
      description: sanitizeDescription(
        definition.description ?? '',
        protectedValues,
      ),
      inputSchema: canonicalize(schemaAdmission.inputSchema),
    };
    input.assertActive?.();
    provisional.push({ index, tool });
  }

  input.assertActive?.();
  const collisionIndexes = findAsciiCaseFoldedCollisionIndexes(
    provisional.map(({ tool }) => tool.id),
  );
  input.assertActive?.();
  const admitted: AdmittedMcpToolDefinition[] = [];
  for (const [provisionalIndex, { index, tool }] of provisional.entries()) {
    input.assertActive?.();
    if (collisionIndexes.has(provisionalIndex)) {
      refused.push({ index, id: tool.id, reason: 'name_collision' });
    } else {
      admitted.push(tool);
    }
  }
  input.assertActive?.();
  refused.sort((left, right) => left.index - right.index);
  input.assertActive?.();

  return { admitted, refused };
}
