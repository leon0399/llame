import { isAbsolute } from "node:path";

/**
 * Caller-supplied values reach git as single arguments of an argv array, never
 * as a command line, and a value that git would read as an option is refused
 * before any process starts.
 *
 * `name`, `branch`, and `baseRef` are the values that would otherwise be
 * spliced in front of git's own options, and a path is the same risk one `-C`
 * away; every one of them goes through {@link optionLikeArgument} first. Where
 * a subcommand accepts `--end-of-options` (or `--`), the remaining caller
 * values follow it as well, so even a value that passes this check cannot be
 * re-read as an option by a later git version.
 */

export type ArgumentRefusal = { readonly ok: false; readonly message: string };
export type ArgumentAccepted = { readonly ok: true };

/**
 * Refuse a caller value that starts with `-`. `label` names the input in the
 * refusal, which is the only text the caller sees.
 */
export function optionLikeArgument(
  label: string,
  value: string,
): ArgumentAccepted | ArgumentRefusal {
  return value.startsWith("-")
    ? { ok: false, message: `A git ${label} must not start with "-".` }
    : { ok: true };
}

export type AbsolutePathAccepted = { readonly ok: true; readonly path: string };

/**
 * Refuse anything but an absolute, NUL-free, option-like-free path. A relative
 * path would be resolved against whichever directory the executor happens to
 * run in, so it never reaches git.
 */
export function absolutePathArgument(
  value: string,
): AbsolutePathAccepted | ArgumentRefusal {
  if (value.includes("\0")) {
    return { ok: false, message: "A git path must not contain a NUL byte." };
  }
  const option = optionLikeArgument("path", value);
  if (!option.ok) return option;
  return isAbsolute(value)
    ? { ok: true, path: value }
    : { ok: false, message: "A git path must be absolute." };
}
