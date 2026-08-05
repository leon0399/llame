#!/usr/bin/env bash
# lefthook pre-commit gate for apps/api/AGENTS.md's "as unknown as T is banned"
# rule (#268). Only flags casts on lines this commit ADDS — a touched file's
# pre-existing casts (144 at the time of writing, migrated in slices) don't
# block, or the gate would immediately force LEFTHOOK=0 on unrelated commits.
set -euo pipefail

violations=0

for file in "$@"; do
  [ -f "$file" ] || continue

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

  # `ast-grep run` follows grep's exit-code convention (1 = no match, not an
  # error) — `|| true` on each stage keeps a cast-free file from tripping
  # `set -e`/`pipefail` and aborting the whole loop before later files run.
  ast_json="$(ast-grep run --pattern '$E as unknown as $T' --lang ts --json "$file" 2>/dev/null)" || true
  matches="$(printf '%s' "$ast_json" | jq -r '.[].range.start.line + 1' 2>/dev/null)" || true
  [ -z "$matches" ] && continue

  while IFS= read -r line; do
    if grep -qxF "$line" <<<"$added_lines"; then
      echo "$file:$line: new \`as unknown as\` cast — banned (apps/api/AGENTS.md § Conventions). Narrow the dependency with Pick<>+@Inject instead (#268)."
      violations=1
    fi
  done <<<"$matches"
done

exit "$violations"
