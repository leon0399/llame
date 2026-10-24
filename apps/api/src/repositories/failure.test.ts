import { STATUS_CODES } from 'node:http';
import type * as NodeHttp from 'node:http';

import { HttpException } from '@nestjs/common';

import {
  REPOSITORY_FAILURE_CODES,
  type RepositoryFailureCode,
  checkoutFailureCode,
  notFound,
  repositoryFailure,
} from './failure';

/**
 * The platform status table, filled from the real one and shared by this file
 * and `./failure`. A case deletes one entry to reach the `?? 'Error'` fallback,
 * which no production status ever asks for.
 */
const platformStatusCodes: Record<number, string | undefined> = vi.hoisted(
  () => ({}),
);

vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeHttp>();
  Object.assign(platformStatusCodes, actual.STATUS_CODES);
  return { ...actual, STATUS_CODES: platformStatusCodes };
});

/**
 * The status every code answers with, restated from the route contract
 * (openspec `repositories` "Registration and removal map failures to typed
 * statuses"). Keeping the table here means a changed mapping fails a unit test
 * instead of quietly shipping a different status to the client.
 */
const EXPECTED_STATUS: Record<RepositoryFailureCode, number> = {
  not_found: 404,
  remote_taken: 409,
  alias_taken: 409,
  path_taken: 409,
  worktree_not_clean: 409,
  invalid_display_name: 422,
  invalid_path: 422,
  invalid_remote: 422,
  invalid_selector: 422,
  not_a_directory: 422,
  origin_mismatch: 422,
  not_a_repository: 422,
  invalid_worktree_base: 422,
  tool_not_allowed: 403,
  permission_denied: 403,
  executor_unavailable: 503,
  machine_unavailable: 503,
  machine_update_required: 503,
  git_failed: 502,
};

describe('repositoryFailure', () => {
  it('covers every code in the vocabulary', () => {
    expect(Object.keys(EXPECTED_STATUS).sort()).toStrictEqual(
      [...REPOSITORY_FAILURE_CODES].sort(),
    );
  });

  it.each(REPOSITORY_FAILURE_CODES)(
    'wraps %s in the documented envelope',
    (code) => {
      const statusCode = EXPECTED_STATUS[code];
      const exception = repositoryFailure(code, 'a message');

      expect(exception).toBeInstanceOf(HttpException);
      expect(exception.getStatus()).toBe(statusCode);
      // The body is exactly the four documented fields, and `error` is the
      // status text the OpenAPI error schema advertises.
      expect(exception.getResponse()).toStrictEqual({
        statusCode,
        error: STATUS_CODES[statusCode],
        message: 'a message',
        code,
      });
    },
  );

  it('keeps the caller message verbatim', () => {
    const message = 'The remote github.com/leon0399/llame is taken.';

    expect(
      repositoryFailure('remote_taken', message).getResponse(),
    ).toMatchObject({ message });
  });

  it('falls back to the generic Error text for a status without one', () => {
    // The `STATUS` table is fixed, so no production code ever asks for a status
    // the platform does not name. Deleting the entry from the shared table is
    // the only way to reach the fallback, and it proves the body never carries
    // `undefined`.
    const conflictText = STATUS_CODES[409];
    delete platformStatusCodes[409];
    try {
      expect(
        repositoryFailure('remote_taken', 'a message').getResponse(),
      ).toStrictEqual({
        statusCode: 409,
        error: 'Error',
        message: 'a message',
        code: 'remote_taken',
      });
    } finally {
      if (conflictText !== undefined) platformStatusCodes[409] = conflictText;
    }
  });
});

describe('notFound', () => {
  it('answers the documented 404 body', () => {
    const exception = notFound();

    expect(exception.getStatus()).toBe(404);
    expect(exception.getResponse()).toStrictEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Repository record not found',
      code: 'not_found',
    });
  });
});

describe('checkoutFailureCode', () => {
  it('answers the daemon refusal as a refused path', () => {
    expect(checkoutFailureCode('path_not_registered')).toBe(
      'permission_denied',
    );
  });

  it('keeps every other executor code', () => {
    expect(checkoutFailureCode('git_failed')).toBe('git_failed');
    expect(checkoutFailureCode('invalid_path')).toBe('invalid_path');
    expect(checkoutFailureCode('machine_unavailable')).toBe(
      'machine_unavailable',
    );
  });
});
