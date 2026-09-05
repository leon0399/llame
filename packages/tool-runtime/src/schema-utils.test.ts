import { describe, expect, it } from 'vitest';

import {
  admitToolInputSchema,
  buildJsonSchemaValidator,
  safeParseArgs,
  resolveJsonSchema,
  toFlexibleSchema,
} from './schema-utils';
import { type JsonSchemaDocument } from './types';
import { z } from 'zod';

describe('buildJsonSchemaValidator', () => {
  it('validates a draft-07 schema (explicit $schema)', () => {
    const schema: JsonSchemaDocument = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    };
    const validate = buildJsonSchemaValidator(schema);
    expect(validate).toBeDefined();
    expect(validate!({ query: 'hello' })).toEqual({
      success: true,
      value: { query: 'hello' },
    });
    expect(validate!({}).success).toBe(false);
  });

  it('validates a schema with no $schema under draft-07 default (3.7)', () => {
    const schema: JsonSchemaDocument = {
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
    };
    const validate = buildJsonSchemaValidator(schema);
    expect(validate).toBeDefined();
    expect(validate!({ q: 'test' }).success).toBe(true);
    expect(validate!({ q: 42 }).success).toBe(false);
  });

  it('validates a 2020-12 schema under 2020-12 rules (3.7)', () => {
    const schema: JsonSchemaDocument = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        items: {
          type: 'array',
          prefixItems: [{ type: 'string' }],
        },
      },
    };
    const validate = buildJsonSchemaValidator(schema);
    expect(validate).toBeDefined();
    expect(validate!({ items: ['hello'] }).success).toBe(true);
  });

  it('returns undefined for an unsupported dialect (3.7)', () => {
    const schema: JsonSchemaDocument = {
      $schema: 'https://json-schema.org/draft/2099-99/schema',
      type: 'object',
    };
    expect(buildJsonSchemaValidator(schema)).toBeUndefined();
  });

  it.each([
    'http://json-schema.org/draft-07/schema',
    'http://json-schema.org/draft-07/schema#',
    'https://json-schema.org/draft-07/schema',
    'https://json-schema.org/draft-07/schema#',
  ])('accepts the draft-07 URI variant %s without rewriting it', ($schema) => {
    const schema: JsonSchemaDocument = {
      $schema,
      type: 'object',
      properties: { count: { type: 'integer' } },
      required: ['count'],
    };

    const validate = buildJsonSchemaValidator(schema);

    expect(validate).toBeDefined();
    expect(validate!({ count: 1 }).success).toBe(true);
    expect(validate!({ count: '1' }).success).toBe(false);
    expect(schema.$schema).toBe($schema);
  });

  it.each([
    ['email', 'owner@example.com', 'not-an-email'],
    ['uri', 'https://example.com/tools/1', 'not a uri'],
    ['date-time', '2026-08-08T12:30:00Z', '08/08/2026 12:30'],
  ])('enforces the standard %s format', (format, valid, invalid) => {
    const schema: JsonSchemaDocument = {
      type: 'object',
      properties: { value: { type: 'string', format } },
      required: ['value'],
    };
    const validate = buildJsonSchemaValidator(schema);

    expect(validate).toBeDefined();
    expect(validate!({ value: valid }).success).toBe(true);
    expect(validate!({ value: invalid }).success).toBe(false);
  });
});

describe('safeParseArgs', () => {
  it('validates a Zod schema', () => {
    const schema = z.object({ query: z.string() });
    expect(safeParseArgs(schema, { query: 'hi' })).toEqual({
      success: true,
      data: { query: 'hi' },
    });
    expect(safeParseArgs(schema, { query: 42 }).success).toBe(false);
  });

  it('validates a JSON Schema document', () => {
    const schema: JsonSchemaDocument = {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    };
    expect(safeParseArgs(schema, { query: 'hi' })).toEqual({
      success: true,
      data: { query: 'hi' },
    });
    expect(safeParseArgs(schema, {}).success).toBe(false);
  });

  it('rejects invalid arguments for a JSON-Schema tool (3.8)', () => {
    const schema: JsonSchemaDocument = {
      type: 'object',
      properties: { count: { type: 'integer', minimum: 1 } },
      required: ['count'],
    };
    const result = safeParseArgs(schema, { count: -5 });
    expect(result.success).toBe(false);
  });
});

describe('admitToolInputSchema', () => {
  it('admits a Zod object schema as a record-shaped JSON Schema', async () => {
    const result = await admitToolInputSchema(z.object({ query: z.string() }));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
    });
  });

  it('returns a raw JSON Schema document by identity', async () => {
    const schema: JsonSchemaDocument = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { query: { type: 'string' } },
    };

    const result = await admitToolInputSchema(schema);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.inputSchema).toBe(schema);
  });
});

describe('toFlexibleSchema', () => {
  it('wraps a Zod schema', () => {
    const schema = z.object({ query: z.string() });
    const result = toFlexibleSchema(schema);
    expect(result).not.toBeNull();
  });

  it('wraps a JSON Schema with ajv validation', () => {
    const schema: JsonSchemaDocument = {
      type: 'object',
      properties: { query: { type: 'string' } },
    };
    const result = toFlexibleSchema(schema);
    expect(result).not.toBeNull();
  });

  it('returns null for an unsupported dialect', () => {
    const schema: JsonSchemaDocument = {
      $schema: 'https://json-schema.org/draft/2099-99/schema',
      type: 'object',
    };
    expect(toFlexibleSchema(schema)).toBeNull();
  });
});

describe('resolveJsonSchema', () => {
  it('resolves a Zod schema to its JSON Schema', async () => {
    const schema = z.object({ query: z.string() });
    const result = await resolveJsonSchema(schema);
    expect(result).toHaveProperty('type', 'object');
    expect(result).toHaveProperty('properties');
  });

  it('returns a JSON Schema document as-is', async () => {
    const schema: JsonSchemaDocument = {
      type: 'object',
      properties: { query: { type: 'string' } },
    };
    const result = await resolveJsonSchema(schema);
    expect(result).toBe(schema);
  });
});
