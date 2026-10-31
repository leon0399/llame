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

/** What a result with both streams empty says instead of them. */
const NO_OUTPUT = "(no output)";

const SECONDS_PER_MS = 1000;

/**
 * The model-facing text of a `bash` result: the status header, stdout
 * verbatim, the labelled stderr, the empty-output phrase, the cut marker, and
 * the cap notice. It renders a stored success and the body of a
 * `command_failed` or `timed_out` message alike.
 */
export function renderBashText(result: UnknownRecord): string {
  const exitCode = isNumber(result.exitCode) ? result.exitCode : 0;
  const wallTimeMs = result.wallTimeMs;
  // Each stream loses the newline that ends its last line, so joining the
  // framing lines adds no blank line after it.
  const stdout = isString(result.stdout)
    ? result.stdout.replace(/\n$/u, "")
    : "";
  const stderr = isString(result.stderr)
    ? result.stderr.replace(/\n$/u, "")
    : "";
  // The status header names the exit code, then the wall time with one
  // decimal when the producer reported one.
  const seconds = isNumber(wallTimeMs)
    ? `, ${(wallTimeMs / SECONDS_PER_MS).toFixed(1)} s`
    : "";
  const lines = [`exit ${exitCode}${seconds}`];
  if (stdout !== "") lines.push(stdout);
  if (stderr !== "") lines.push(STDERR_LABEL, stderr);
  if (stdout === "" && stderr === "") lines.push(NO_OUTPUT);
  if (result.truncated === true) lines.push(OUTPUT_CUT_MARKER);
  const { truncationNotice } = result;
  if (isString(truncationNotice) && truncationNotice !== "")
    lines.push(`[${truncationNotice}]`);
  return lines.join("\n");
}
