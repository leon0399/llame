#!/usr/bin/env bash
# lefthook pre-commit gate for apps/api/AGENTS.md's "as unknown as T is banned"
# rule (#268). Only flags casts on lines this commit ADDS — a touched file's
# pre-existing casts (144 at the time of writing, migrated in slices) don't
# block, or the gate would immediately force LEFTHOOK=0 on unrelated commits.
#
# Scans the STAGED blob (git show ":$file"), never the working tree, so
# partial staging / commit -a can't desync the diff-derived line numbers from
# what ast-grep sees. Requires ast-grep + jq on PATH (both provisioned by
# `nix develop`, see flake.nix) — fails loudly rather than silently no-opping
# when either is missing, since a gate that can silently do nothing is worse
# than no gate at all.
set -euo pipefail

for tool in ast-grep jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "check-new-unknown-as-casts.sh: '$tool' not found on PATH — run inside 'nix develop', or install it, to enable this gate. (LEFTHOOK=0 git commit bypasses it for one commit.)" >&2
    exit 1
  fi
done

staged_tmp=""
# Reused across every ast-grep/jq call in the loop (truncated before each
# use with `: >"$err_tmp"`) rather than a fresh mktemp per call — same
# stderr-capture job, a fraction of the subprocess spawns.
err_tmp="$(mktemp)"
cleanup() {
  # `if`, not `[ -n ... ] && rm ...` — the latter returns 1 whenever the var
  # is empty (the normal case), and as the EXIT trap's last command that
  # would override `exit "$violations"` below, silently turning every clean
  # run into a failure.
  if [ -n "$staged_tmp" ]; then
    rm -f "$staged_tmp"
  fi
  rm -f "$err_tmp"
}
trap cleanup EXIT

violations=0

for file in "$@"; do
  # Line numbers this commit actually adds, in the NEW file. Only lines
  # inside a hunk body (after its `@@ ... @@` header) count — skipping
  # everything before the first hunk (the `diff --git`/`index`/`---`/`+++`
  # preamble) structurally, rather than pattern-matching `+++`, means a
  # genuinely added line whose own content starts with `++` (e.g. `++x;`,
  # which the diff renders as `+++x;`) is never mistaken for that preamble.
  added_lines="$(git diff --cached -U0 -- "$file" | awk '
    /^@@/ {
      seen_hunk = 1
      match($0, /\+[0-9]+/)
      newline = substr($0, RSTART + 1, RLENGTH - 1) + 0
      next
    }
    !seen_hunk { next }
    /^\+/ { print newline; newline++; next }
  ')"
  [ -z "$added_lines" ] && continue
  # O(1) membership test below instead of forking `grep` per candidate line.
  declare -A added=()
  while IFS= read -r n; do added["$n"]=1; done <<<"$added_lines"

  # ast-grep needs a real extension to pick a parser even with --lang forced.
  # A plain positional template (no --suffix flag) is the portable form —
  # GNU mktemp's --suffix is rejected outright by BSD/macOS mktemp, but both
  # preserve literal text after the X run in a template argument.
  staged_tmp="$(mktemp "${TMPDIR:-/tmp}/check-cast.XXXXXX.${file##*.}")"
  # A deleted file has no staged blob — `git show` fails and `continue`
  # applies the same as any other cast-free file.
  git show ":$file" >"$staged_tmp" 2>/dev/null || {
    rm -f "$staged_tmp"
    staged_tmp=""
    continue
  }

  # `ast-grep run` follows grep's exit-code convention (1 = no match, not an
  # error), so a clean file can't be distinguished from a real failure by
  # exit code alone — verified empirically, ast-grep exits 1 for both "no
  # match" and e.g. "file not found". stderr is the reliable signal: a
  # successful run (match or no match) never writes to it; a real failure
  # does. Capture it via a temp file rather than a variable — `2>&1` would
  # merge it into $ast_json and corrupt the JSON we need to parse.
  : >"$err_tmp"
  ast_json="$(ast-grep run --pattern '$E as unknown as $T' --lang ts --json "$staged_tmp" 2>"$err_tmp")" || true
  rm -f "$staged_tmp"
  staged_tmp=""

  if [ -s "$err_tmp" ]; then
    echo "check-new-unknown-as-casts.sh: ast-grep failed on $file — treating as a gate failure, not a clean file:" >&2
    cat "$err_tmp" >&2
    exit 1
  fi

  # The line(s) spanning from where $E ends to where $T starts — where the
  # `as unknown as` keywords themselves actually sit — not the whole match
  # (which includes $E, and for a multi-line $E like an object literal, an
  # edit to an UNRELATED line inside it, with the cast itself untouched,
  # would otherwise false-positive as a new cast). Usually one line; the
  # `as`/`unknown`/`as` tokens can themselves span multiple lines in
  # unusually formatted code, hence a range rather than a single line.
  : >"$err_tmp"
  spans="$(printf '%s' "$ast_json" | jq -r '.[] | "\(.metaVariables.single.E.range.end.line + 1) \(.metaVariables.single.T.range.start.line + 1)"' 2>"$err_tmp")" || true

  if [ -s "$err_tmp" ]; then
    echo "check-new-unknown-as-casts.sh: jq failed to parse ast-grep's output for $file — treating as a gate failure, not a clean file:" >&2
    cat "$err_tmp" >&2
    exit 1
  fi

  [ -z "$spans" ] && continue

  while IFS=' ' read -r start end; do
    for ((ln = start; ln <= end; ln++)); do
      if [ -n "${added[$ln]:-}" ]; then
        echo "$file:$end: new \`as unknown as\` cast — banned (apps/api/AGENTS.md § Conventions). Narrow the dependency with Pick<>+@Inject instead (#268)."
        violations=1
        break
      fi
    done
  done <<<"$spans"
done

exit "$violations"
