import {
  absoluteGitPath,
  DEFAULT_GIT_TIMEOUT_MS,
  processFailure,
  withGit,
} from "./invocation";
import type { GitFailure, GitStatusResult } from "./types";

/*
 * `git.status`: whether the working tree holds changes, and where its branch
 * stands against its upstream. Read-only, argv only, and under the same fixed
 * environment and hooks directory as the other operations.
 *
 * `ahead` is the count of commits the branch holds that its upstream does not;
 * a branch without an upstream reports `ahead: 0` and no `upstream`, because
 * "ahead of nothing" is not the same statement as "nothing to push".
 */

function invalidInput(message: string): GitFailure {
  return { status: "error", type: "invalid_input", message };
}

export async function statusRepository(
  input: { readonly path: string },
  options: { readonly timeoutMs?: number } = {},
): Promise<GitStatusResult> {
  const path = absoluteGitPath(input.path);
  if (!("path" in path)) return invalidInput(path.message);

  return withGit(
    path.path,
    options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
    async (git) => {
      const head = await git(["rev-parse", "--verify", "--quiet", "HEAD"]);
      // An unborn branch exits 1 with no message; that is a repository whose
      // HEAD names no commit yet, not a failed call.
      if (head.status === "timed_out") return processFailure(head);

      const tracking = await git([
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "--verify",
        "--quiet",
        "@{upstream}",
      ]);
      if (tracking.status === "timed_out") return processFailure(tracking);
      const upstream = tracking.status === "ok" ? tracking.stdout.trim() : "";

      let ahead = 0;
      if (upstream !== "") {
        const counted = await git(["rev-list", "--count", `${upstream}..HEAD`]);
        if (counted.status !== "ok") return processFailure(counted);
        ahead = Number.parseInt(counted.stdout.trim(), 10) || 0;
      }

      const changed = await git(["status", "--porcelain", "-z"]);
      if (changed.status !== "ok") return processFailure(changed);

      const status = {
        status: "ok" as const,
        dirty: changed.stdout !== "",
        ahead,
        head: head.status === "ok" ? head.stdout.trim() : null,
      };
      return upstream === "" ? status : { ...status, upstream };
    },
  );
}
