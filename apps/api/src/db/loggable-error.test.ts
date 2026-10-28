import { DrizzleQueryError } from 'drizzle-orm';

import { errorMessageWithoutParams, loggableError } from './loggable-error';

/** A bind value long enough to be unmistakable in any log line. */
const RETAINED_BYTES = 'A'.repeat(64 * 1024);

describe('loggableError', () => {
  it('keeps the statement and the cause, without the bind values', () => {
    const cause = new Error('duplicate key value violates unique constraint');
    const error = new DrizzleQueryError(
      'insert into "messages" ("parts") values ($1)',
      [RETAINED_BYTES],
      cause,
    );

    const line = loggableError(error);

    expect(line).toContain('Failed query: insert into "messages"');
    expect(line).toContain(cause.stack ?? cause.message);
    expect(line).not.toContain(RETAINED_BYTES);
    expect(line).not.toContain('params:');
  });

  it('logs the statement alone when the query error has no cause', () => {
    const error = new DrizzleQueryError('select 1', []);

    expect(loggableError(error)).toBe('Failed query: select 1');
  });

  it('logs the stack of any other error', () => {
    const error = new Error('plain failure');

    expect(loggableError(error)).toBe(error.stack);
    expect(loggableError('not an error')).toBe('not an error');
  });
});

describe('errorMessageWithoutParams', () => {
  it('reports a failed query as its statement, without the bind values', () => {
    const error = new DrizzleQueryError(
      'insert into "messages" ("parts") values ($1)',
      [RETAINED_BYTES],
      new Error('invalid input syntax for type json'),
    );

    const message = errorMessageWithoutParams(error);

    expect(message).toBe(
      'Failed query: insert into "messages" ("parts") values ($1)',
    );
    expect(message).not.toContain(RETAINED_BYTES);
  });

  it('reports any other error as its own message', () => {
    expect(errorMessageWithoutParams(new Error('plain failure'))).toBe(
      'plain failure',
    );
    expect(errorMessageWithoutParams('not an error')).toBe('not an error');
  });
});
