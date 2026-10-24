/**
 * Bounding and redaction for text git wrote.
 *
 * Standard error reaches an API response, so it is bounded to a fixed size and
 * has URL credentials removed before it leaves this package: a remote URL can
 * carry a token in its userinfo part, and a failed fetch-shaped command can
 * echo it back. Standard output is machine-read only and gets its own, wider
 * bound so one unexpected listing cannot grow a response without limit.
 */

/** The bound every returned standard error respects. */
export const STDERR_BOUND = 4096;

/** The bound on a command's standard output. */
export const STDOUT_BOUND = 1_048_576;

/** Keep at most `bound` characters, marking the cut. */
export function boundedText(text: string, bound: number): string {
  return text.length <= bound ? text : `${text.slice(0, bound)}\n[truncated]`;
}

/**
 * Remove the userinfo part of every `scheme://user:password@host` URL, which is
 * where a clone URL carries a token. The `scp`-style `git@host:path` form has
 * no password position and is left as written.
 */
export function redactCredentials(text: string): string {
  return text.replaceAll(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/giu, "$1");
}
