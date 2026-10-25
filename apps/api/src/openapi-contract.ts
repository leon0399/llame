import type { OpenAPIObject } from '@nestjs/swagger';
import { isRecord, isString } from '@workspace/runtime-safety';

// @nestjs/swagger exports only the document type; the parts come from it.
type OperationObject = NonNullable<OpenAPIObject['paths'][string]['get']>;

const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;
const SCHEMA_PREFIX = '#/components/schemas/';

function operations(document: OpenAPIObject): Array<OperationObject> {
  return Object.values(document.paths).flatMap((item) =>
    METHODS.flatMap((method) => item[method] ?? []),
  );
}

/** Every component schema name a value refers to, directly or nested. */
function collectRefs(value: unknown, names: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectRefs(entry, names);
    return;
  }
  if (!isRecord(value)) return;
  const ref = value.$ref;
  if (isString(ref) && ref.startsWith(SCHEMA_PREFIX)) {
    names.add(ref.slice(SCHEMA_PREFIX.length));
  }
  for (const entry of Object.values(value)) collectRefs(entry, names);
}

/** Closes `names` over the component schemas they reference: a Set's
 *  iteration also visits the names added while it runs. */
function reachableSchemas(document: OpenAPIObject, names: Set<string>): void {
  const schemas = document.components?.schemas ?? {};
  for (const name of names) collectRefs(schemas[name], names);
}

/** An object schema with declared properties and no stated policy for
 *  others. */
function closeObject(schema: unknown): void {
  if (!isRecord(schema)) return;
  if (isRecord(schema.properties) && !('additionalProperties' in schema)) {
    Object.assign(schema, { additionalProperties: false });
  }
}

/**
 * Request bodies are validated with `forbidNonWhitelisted`, so a property the
 * DTO does not declare is a 400. Every schema a request body reaches says so,
 * which nested DTOs honor because each is a validated class
 * (`@ValidateNested` + `@Type`). No request schema is also a response schema,
 * so responses keep their open shape.
 */
function closeRequestBodies(document: OpenAPIObject): void {
  const names = new Set<string>();
  for (const operation of operations(document)) {
    const body = operation.requestBody;
    if (body === undefined || '$ref' in body) continue;
    for (const media of Object.values(body.content)) {
      collectRefs(media.schema, names);
      closeObject(media.schema);
    }
  }
  reachableSchemas(document, names);
  const schemas = document.components?.schemas ?? {};
  for (const name of names) closeObject(schemas[name]);
}

/** Whether a JSON body schema names no required property, so a missing
 *  body (validated as `{}`) is accepted. */
function acceptsEmpty(document: OpenAPIObject, schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  const ref = schema.$ref;
  const resolved =
    isString(ref) && ref.startsWith(SCHEMA_PREFIX)
      ? document.components?.schemas?.[ref.slice(SCHEMA_PREFIX.length)]
      : schema;
  if (!isRecord(resolved) || !isRecord(resolved.properties)) return false;
  return !Array.isArray(resolved.required) || resolved.required.length === 0;
}

/**
 * Nest validates a missing JSON body as `{}`, so a body whose fields are all
 * optional is itself optional: an empty PATCH is a no-op update.
 */
function markOptionalBodies(document: OpenAPIObject): void {
  for (const operation of operations(document)) {
    const body = operation.requestBody;
    if (body === undefined || '$ref' in body) continue;
    const json = body.content['application/json'];
    if (json !== undefined && acceptsEmpty(document, json.schema)) {
      body.required = false;
    }
  }
}

/**
 * Documents the refusals every operation can give, whatever its decorators
 * say: the global validation pipes (`ValidationPipe`, the NUL check,
 * `ParseUUIDPipe`) answer 400, and the JSON body parser answers 413 for a body
 * over its limit.
 */
function documentFrameworkRefusals(document: OpenAPIObject): void {
  for (const operation of operations(document)) {
    operation.responses['400'] ??= {
      description: 'The request failed validation.',
    };
    if (operation.requestBody !== undefined) {
      operation.responses['413'] ??= {
        description: 'The request body is larger than the server accepts.',
      };
    }
  }
}

/** The generated document, completed with what the framework enforces
 *  outside the decorators. */
export function completeContract(document: OpenAPIObject): OpenAPIObject {
  closeRequestBodies(document);
  markOptionalBodies(document);
  documentFrameworkRefusals(document);
  return document;
}
