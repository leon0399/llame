import { HttpException } from '@nestjs/common';

/**
 * The typed failure envelope of the repository and checkout routes
 * (openspec `repositories` "Registration and removal map failures to typed
 * statuses"). The body is exactly the documented error shape — `statusCode`,
 * `error`, `message`, `code` — so the OpenAPI error schema and a real response
 * cannot drift apart.
 */

// Every code these routes answer, in one closed vocabulary.
export const REPOSITORY_FAILURE_CODES = [
  'not_found',
  'remote_taken',
  'alias_taken',
  'path_taken',
  'invalid_display_name',
  'invalid_path',
  'invalid_remote',
  'invalid_selector',
  'not_a_directory',
  'origin_mismatch',
  'not_a_repository',
  'invalid_worktree_base',
  'tool_not_allowed',
  'permission_denied',
  'executor_unavailable',
  'git_failed',
] as const;

export type RepositoryFailureCode = (typeof REPOSITORY_FAILURE_CODES)[number];

type FailureKind =
  | 'not_found'
  | 'conflict'
  | 'forbidden'
  | 'unprocessable'
  | 'bad_gateway'
  | 'unavailable';

const FAILURE_STATUS = {
  not_found: { statusCode: 404, error: 'Not Found' },
  conflict: { statusCode: 409, error: 'Conflict' },
  forbidden: { statusCode: 403, error: 'Forbidden' },
  unprocessable: { statusCode: 422, error: 'Unprocessable Entity' },
  bad_gateway: { statusCode: 502, error: 'Bad Gateway' },
  unavailable: { statusCode: 503, error: 'Service Unavailable' },
} as const satisfies Record<FailureKind, { statusCode: number; error: string }>;

/** The exception one typed failure answers with. */
export function repositoryFailure(
  kind: FailureKind,
  code: RepositoryFailureCode,
  message: string,
): HttpException {
  const status = FAILURE_STATUS[kind];
  return new HttpException(
    { statusCode: status.statusCode, error: status.error, message, code },
    status.statusCode,
  );
}

/** A repository or checkout the caller does not own is simply not there. */
export function notFound(): HttpException {
  return repositoryFailure(
    'not_found',
    'not_found',
    'Repository record not found',
  );
}
