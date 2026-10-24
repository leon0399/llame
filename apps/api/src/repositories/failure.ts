import { STATUS_CODES } from 'node:http';

import { HttpException, HttpStatus } from '@nestjs/common';

import { type ExecutorGitErrorCode } from '../machines/executor-git.service';

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
  'machine_unavailable',
  'machine_update_required',
  'git_failed',
] as const;

export type RepositoryFailureCode = (typeof REPOSITORY_FAILURE_CODES)[number];

// Each code has exactly one status, so a call site cannot pair the wrong pair.
const STATUS: Record<RepositoryFailureCode, HttpStatus> = {
  not_found: HttpStatus.NOT_FOUND,
  remote_taken: HttpStatus.CONFLICT,
  alias_taken: HttpStatus.CONFLICT,
  path_taken: HttpStatus.CONFLICT,
  invalid_display_name: HttpStatus.UNPROCESSABLE_ENTITY,
  invalid_path: HttpStatus.UNPROCESSABLE_ENTITY,
  invalid_remote: HttpStatus.UNPROCESSABLE_ENTITY,
  invalid_selector: HttpStatus.UNPROCESSABLE_ENTITY,
  not_a_directory: HttpStatus.UNPROCESSABLE_ENTITY,
  origin_mismatch: HttpStatus.UNPROCESSABLE_ENTITY,
  not_a_repository: HttpStatus.UNPROCESSABLE_ENTITY,
  invalid_worktree_base: HttpStatus.UNPROCESSABLE_ENTITY,
  tool_not_allowed: HttpStatus.FORBIDDEN,
  permission_denied: HttpStatus.FORBIDDEN,
  executor_unavailable: HttpStatus.SERVICE_UNAVAILABLE,
  machine_unavailable: HttpStatus.SERVICE_UNAVAILABLE,
  machine_update_required: HttpStatus.SERVICE_UNAVAILABLE,
  git_failed: HttpStatus.BAD_GATEWAY,
};

/**
 * The route code for one executor refusal. The daemon's own
 * `path_not_registered` is its refusal of the address, which these routes
 * answer as 403 `permission_denied`; every other code is already one of theirs.
 */
export function checkoutFailureCode(
  code: ExecutorGitErrorCode,
): RepositoryFailureCode {
  return code === 'path_not_registered' ? 'permission_denied' : code;
}

/** The exception one typed failure answers with. */
export function repositoryFailure(
  code: RepositoryFailureCode,
  message: string,
): HttpException {
  const statusCode = STATUS[code];
  return new HttpException(
    {
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      message,
      code,
    },
    statusCode,
  );
}

/** A repository or checkout the caller does not own is simply not there. */
export function notFound(): HttpException {
  return repositoryFailure('not_found', 'Repository record not found');
}
