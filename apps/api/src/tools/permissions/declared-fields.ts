import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

/**
 * The top-level properties a JSON Schema may present as strings. Code-owned
 * schemas are simple objects; an admitted MCP declaration may compose its
 * object through `allOf`/`anyOf`/`oneOf`, so property discovery recurses those
 * branches. Unions inside a property's own type are handled by
 * {@link schemaPermitsString}.
 */
export function declaredStringProperties(
  document: UnknownRecord,
): ReadonlySet<string> {
  const fields = new Set<string>();
  collectDeclaredProperties(document, fields);
  return fields;
}

function collectDeclaredProperties(schema: unknown, fields: Set<string>): void {
  if (!isRecord(schema)) return;
  const properties = schema['properties'];
  if (isRecord(properties)) {
    for (const [name, propertySchema] of Object.entries(properties)) {
      if (schemaPermitsString(propertySchema)) fields.add(name);
    }
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    const branches = schema[keyword];
    if (Array.isArray(branches)) {
      for (const branch of branches) collectDeclaredProperties(branch, fields);
    }
  }
}

export function schemaPermitsString(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- a raw JSON Schema fragment: `true` and records are both valid; the `isRecord` guard below establishes the contract before any property access.
  schema: unknown,
): boolean {
  // JSON Schema `true` accepts any value, including a string.
  if (schema === true) return true;
  if (!isRecord(schema)) return false;

  const type = schema['type'];
  if (type === 'string') return true;
  if (Array.isArray(type) && type.includes('string')) return true;

  const constValue = schema['const'];
  if (isString(constValue)) return true;
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && enumValues.some(isString)) return true;

  const allOf = schema['allOf'];
  if (Array.isArray(allOf) && allOf.every(schemaPermitsString)) return true;
  const anyOf = schema['anyOf'];
  if (Array.isArray(anyOf) && anyOf.some(schemaPermitsString)) return true;
  const oneOf = schema['oneOf'];
  if (Array.isArray(oneOf) && oneOf.some(schemaPermitsString)) return true;

  // With no type, const, enum, or composition constraint, any JSON value —
  // including a string — is valid, so the field may be a string.
  const constrained =
    type !== undefined ||
    constValue !== undefined ||
    enumValues !== undefined ||
    Array.isArray(allOf) ||
    Array.isArray(anyOf) ||
    Array.isArray(oneOf);
  return !constrained;
}
