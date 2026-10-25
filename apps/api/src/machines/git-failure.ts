import { type GitFailure } from '@workspace/machine-protocol';

/*
 * One typed git failure as the bounded, redacted text a caller reports. An
 * invalid input is the executor's own refusal and carries its message; a git
 * failure or timeout carries standard error that the executor already redacted
 * and bounded, and an empty one names the operation instead of an empty string.
 */

/** The message one typed git failure reports. */
export function gitFailureMessage(failure: GitFailure): string {
  if (!('stderr' in failure)) return failure.message;
  return failure.stderr === ''
    ? 'The worktree command failed.'
    : failure.stderr;
}
