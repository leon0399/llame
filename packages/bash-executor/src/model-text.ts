import {
  isNumber,
  isString,
  type UnknownRecord,
} from "@workspace/runtime-safety";

/*
 * The model-facing text of a `bash` result (tool-result-rendering "A bash
 * result renders a status header and its streams"). The stored result keeps
 * the exit code, the wall time, the two bounded streams, and its truncation
 * flags, so this module adds only the framing: the status header, the `[stderr]`
 * label, the empty-output phrase, and the markers a cut or the cap adds.
 *
 * The return value is the raw text; the one reserved-name rule is applied by
 * the caller, once, to the whole rendering.
 */

/** The one marker a result the executor cut ends with. */
const OUTPUT_CUT_MARKER = "[output cut at the bound]";

/** The stream label a non-empty stderr follows. */
const STDERR_LABEL = "[stderr]";

/** What a result that produced no bytes at all says instead of the streams. */
const NO_OUTPUT = "(no output)";

const MILLISECONDS_PER_SECOND = 1000;

/**
 * The model-facing text of a `bash` result: the status header, stdout
 * verbatim, the labelled stderr, the empty-output phrase, the cut marker, and
 * the cap notice. It renders a stored success and the body of a
 * `command_failed` or `timed_out` message alike.
 *
 * A command a timeout stopped never exited, so its header names itself and the
 * time it ran — `timed out, 30.0 s` — and carries no exit code. A result that
 * reports no wall time omits the seconds.
 */
export function renderBashText(result: UnknownRecord): string {
  const wallTimeMs = result.wallTimeMs;
  const seconds = isNumber(wallTimeMs)
    ? `, ${(wallTimeMs / MILLISECONDS_PER_SECOND).toFixed(1)} s`
    : "";
  const exitCode = isNumber(result.exitCode) ? result.exitCode : 0;
  const header =
    result.type === "timed_out"
      ? `timed out${seconds}`
      : `exit ${exitCode}${seconds}`;
  // Each stream keeps what it produced: only the newline that ends its last
  // line is dropped, so joining the framing lines adds no blank line after it.
  // A stream of one newline therefore keeps one empty line, and only a pair of
  // empty streams is no output.
  const produced = isString(result.stdout) ? result.stdout : "";
  const failed = isString(result.stderr) ? result.stderr : "";
  const stdout = produced.replace(/\n$/u, "");
  const stderr = failed.replace(/\n$/u, "");
  const lines = [header];
  if (produced !== "") lines.push(stdout);
  if (failed !== "") lines.push(STDERR_LABEL, stderr);
  if (produced === "" && failed === "") lines.push(NO_OUTPUT);
  if (result.truncated === true) lines.push(OUTPUT_CUT_MARKER);
  const { truncationNotice } = result;
  if (isString(truncationNotice) && truncationNotice !== "")
    lines.push(`[${truncationNotice}]`);
  return lines.join("\n");
}
