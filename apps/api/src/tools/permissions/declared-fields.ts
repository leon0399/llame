import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';

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

export function schemaPermitsString(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  const type = schema['type'];
  if (type === 'string') return true;
  if (Array.isArray(type) && type.includes('string')) return true;
  for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
    const branches = schema[keyword];
    if (Array.isArray(branches) && branches.some(schemaPermitsString)) {
      return true;
    }
  }
  return false;
}
