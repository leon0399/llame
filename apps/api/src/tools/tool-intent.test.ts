import { isRecord, isString } from '@workspace/runtime-safety';

import { safeParseArgs } from './schema-utils';
import { splitToolIntent, withToolIntent } from './tool-intent';
import { type JsonSchemaDocument } from './types';

const executorSchema = {
  type: 'object',
  properties: { command: { type: 'string' } },
  required: ['command'],
  additionalProperties: false,
};

/** The model-facing description of the `i` argument, or an empty string. */
function intentDescriptionOf(schema: JsonSchemaDocument): string {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const property = isRecord(properties.i) ? properties.i : {};

  return isString(property.description) ? property.description : '';
}

it('requires intent on the model envelope without changing executor validation', () => {
  const modelSchema = withToolIntent('bash', executorSchema);
  const submitted = { i: 'Checking the working directory', command: 'pwd' };

  expect(intentDescriptionOf(modelSchema)).toContain(
    'REQUIRED on every call to this tool.',
  );

  expect(safeParseArgs(modelSchema, { command: 'pwd' }).success).toBe(false);
  expect(safeParseArgs(modelSchema, submitted).success).toBe(true);
  expect(safeParseArgs(executorSchema, submitted).success).toBe(false);
  expect(
    safeParseArgs(executorSchema, splitToolIntent('bash', submitted).input)
      .success,
  ).toBe(true);
  expect(
    safeParseArgs(modelSchema, { ...submitted, command: 42 }).success,
  ).toBe(false);
});

it.each(['', '   \n\t', 'x'.repeat(121), 42, null])(
  'refuses malformed intent in the model envelope: %j',
  (i) => {
    expect(
      safeParseArgs(withToolIntent('bash', executorSchema), {
        command: 'pwd',
        i,
      }).success,
    ).toBe(false);
  },
);

it('requires only the intent for an otherwise optional argument object', () => {
  const schema = withToolIntent('read', {
    type: 'object',
    properties: { path: { type: 'string' } },
    additionalProperties: false,
  });

  expect(safeParseArgs(schema, {}).success).toBe(false);
  expect(safeParseArgs(schema, { i: 'Listing allowed roots' }).success).toBe(
    true,
  );
});

it('leaves an MCP server own i argument under its original schema', () => {
  const serverSchema = {
    ...executorSchema,
    properties: { i: { type: 'number' } },
    required: ['i'],
  };

  const input = { i: 42 };

  expect(
    safeParseArgs(withToolIntent('mcp__math__evaluate', serverSchema), input)
      .success,
  ).toBe(true);
  expect(splitToolIntent('mcp__math__evaluate', input)).toEqual({ input });
});
