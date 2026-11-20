import { safeParseArgs } from './schema-utils';
import { splitToolIntent, withToolIntent } from './tool-intent';

const executorSchema = {
  type: 'object',
  properties: { command: { type: 'string' } },
  required: ['command'],
  additionalProperties: false,
};

it('requires intent on the model envelope without changing executor validation', () => {
  const modelSchema = withToolIntent('bash', executorSchema);
  const submitted = { i: 'Checking the working directory', command: 'pwd' };

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
