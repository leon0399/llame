import { z } from "zod";

import { getApiErrorInfo } from "../../api/errors";

/** The one field of the typed failure envelope this module reads. */
const failureEnvelope = z.object({ message: z.string().trim().min(1) });

/**
 * The server's own refusal sentence for a repository, checkout, or project-link
 * failure, or `fallback` when the failure carries no typed envelope (a network
 * error, say). The routes answer `{ statusCode, error, code, message }`, and
 * the message is written for a reader — "The worktree holds uncommitted
 * changes." is the refusal a guarded Remove must show, not a generic one.
 */
export function repositoryFailureMessage(error: unknown, fallback: string) {
  const parsed = failureEnvelope.safeParse(getApiErrorInfo(error));
  return parsed.success ? parsed.data.message : fallback;
}
