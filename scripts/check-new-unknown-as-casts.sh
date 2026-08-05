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
cleanup() {
  [ -n "$staged_tmp" ] && rm -f "$staged_tmp"
}
trap cleanup EXIT

violations=0

for file in "$@"; do
  # A deleted file has no staged blob and nothing to scan.
  git cat-file -e ":$file" 2>/dev/null || continue

  added_lines="$(git diff --cached -U0 -- "$file" | awk '
    /^@@/ {
      match($0, /\+[0-9]+/)
      newline = substr($0, RSTART + 1, RLENGTH - 1) + 0
      next
    }
    /^\+\+\+/ { next }
    /^\+/ { print newline; newline++; next }
  ')"
  [ -z "$added_lines" ] && continue

  # ast-grep needs a real extension to pick a parser even with --lang forced.
  staged_tmp="$(mktemp --suffix=".${file##*.}")"
  git show ":$file" >"$staged_tmp"

  # `ast-grep run` follows grep's exit-code convention (1 = no match, not an
  # error) — `|| true` on each stage keeps a cast-free file from tripping
  # `set -e`/`pipefail` and aborting the whole loop before later files run.
  ast_json="$(ast-grep run --pattern '$E as unknown as $T' --lang ts --json "$staged_tmp" 2>/dev/null)" || true
  # Emit each match's full line span, not just its first line — a cast
  # appended after an unchanged multi-line expression (`{\n  ...\n} as
  # unknown as T;`) reports its match start on the expression's first line,
  # which the diff never lists as added; checking the whole span catches the
  # line the cast keyword actually sits on.
  spans="$(printf '%s' "$ast_json" | jq -r '.[] | "\(.range.start.line + 1) \(.range.end.line + 1)"' 2>/dev/null)" || true

  rm -f "$staged_tmp"
  staged_tmp=""

  [ -z "$spans" ] && continue

  while IFS=' ' read -r start end; do
    for ((ln = start; ln <= end; ln++)); do
      if grep -qxF "$ln" <<<"$added_lines"; then
        echo "$file:$end: new \`as unknown as\` cast — banned (apps/api/AGENTS.md § Conventions). Narrow the dependency with Pick<>+@Inject instead (#268)."
        violations=1
        break
      fi
    done
  done <<<"$spans"
done

exit "$violations"
