import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';

/**
 * The top-level properties a JSON Schema may present as strings. Code-owned
 * schemas are simple objects; unions are recursed so an `anyOf`/`oneOf`/`allOf`
 * string branch is accepted. Used at boot for code-owned field validation and
 * at execution for an exact MCP declaration.
 */
export function declaredStringProperties(
  document: UnknownRecord,
): ReadonlySet<string> {
  const properties = document['properties'];
  if (!isRecord(properties)) return new Set();
  const fields = new Set<string>();
  for (const [name, schema] of Object.entries(properties)) {
    if (schemaPermitsString(schema)) fields.add(name);
  }
  return fields;
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
