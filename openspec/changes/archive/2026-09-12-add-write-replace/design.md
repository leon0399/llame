## Context

See `proposal.md` for motivation. The mechanism this change needs already
ships, in service of `edit`: `publishFile` in `packages/native-file-tools`
takes `{ create: boolean }` — `true` publishes by `link` (create-only,
`EEXIST` on collision), `false` publishes by `rename` (atomic replace) — and
`editFile` already resolves an absolute target through `realpath`, captures
its permission mode, and republishes through that path. The `kb://` dispatch
in `apps/api/src/tools/native-files.ts` already resolves the leaf differently
per operation (`allowMissing` for `write`, required-existing for `edit`) and
creates intermediate directories only for writes. The durable pre-effect
fence records the operation as `write` before any byte changes and is
mode-agnostic. So this change routes one new precondition through existing
machinery; it adds no new publication, resolution, or fencing path.

## Goals / Non-Goals

**Goals:**

- The four flag-by-existence outcomes of `proposal.md`, on both schemes.
- Atomic, permission-preserving, fenced replacement.
- Error wording that lets the model self-correct in either direction (omit
  the flag to create; use `edit` for partial changes).
- Byte-identical create-only behavior when the flag is absent or `false`.

**Non-Goals:**

- Content compare-and-swap (hash- or precondition-based replace); a later
  revision service can add it without touching this contract.
- Capturing or diffing the previous contents in the result.
- Append, partial, or patch writes; any `edit` change.
- Classification or permission changes; `replace` grants no authority `edit`
  does not already have.

## Decisions

### D1: One boolean named `replace`; absent ≡ false

`replace: true` asserts the target exists and authorizes replacing its
contents. The strict boolean schema rejects every other type before dispatch,
so only absent, `false` (both create-only), and `true` (replace) reach a
filesystem check. The two modes
are each other's inverse guard, mirroring `open(2)`'s `O_CREAT|O_EXCL` versus
`O_TRUNC`: create mode fails when the target exists, replace mode fails when
it does not. The second failure is the point — a write aimed at a
hallucinated, moved, or deleted path surfaces as `not_found` instead of
silently creating a file.

Alternative: `overwrite`. Same semantics; rejected only on vocabulary —
`edit` "replaces one current unique match", and the success marker below is
`replaced`, so `replace` keeps one verb family across the two mutation tools.

### D2: Route by precondition, reuse the edit publication path

The package gains `replaceFile` beside `createFile`; the tools layer picks per
the input flag. `replaceFile` mirrors `editFile`'s target handling on an
absolute path: `realpath` (missing or dangling link → `not_found`), a
regular-file check (directory → `not_regular_file`), and mode capture, then
`publishFile({ create: false, mode })` — the same temp-file, `fsync`, `rename`
publication `edit` uses. `createFile` is untouched. Error precedence stays as
today: path validity, then target state, then content validation, all before
any byte changes.

For `kb://`, replace mode resolves the locator with the leaf required to exist
(the resolution `edit` uses today) and skips directory creation entirely; the
scheme owner's symlink refusal and containment checks apply unchanged, and
the mutation still records the locator, never the resolved host path.

Alternative: a `mode` parameter threaded through `createFile`. Rejected — two
straight-line functions with one shared publisher are smaller than one
function with a branching precondition, and the tools layer already switches
per operation.

### D3: Result carries `replaced`, never old content

Success is `{ status: "success", operation: "write", replaced: true, ... }`
against create's `created: true`, with the same bounded post-write content
preview and an empty diff. The previous contents are not captured, diffed, or
echoed: a whole-file diff is noise at exactly the sizes where replace is the
right tool, it would double memory on large files, and the settled result must
replay through the fence regardless. Git-backed recovery (#212) is the
history story, not the write result. No current consumer reads `created`, so
the marker pair is purely model- and event-log-facing.

### D4: Fence and classification unchanged

The attempt is recorded before any byte changes with operation `write`,
exactly as a create is today; an open attempt recovers as `outcome_unknown`,
and a settled result (including the `not_found`/`file_exists` failures) replays
without re-execution. The fence is mode-agnostic because no fencing decision
depends on the mode. Classification stays `write_low_risk`: `edit` with
whole-file `oldText` already performs full replacement under the same
authority, so the flag adds explicit intent, not capability.

### D5: Error wording is the affordance

Create mode keeps `file_exists`, with a message naming `replace: true` as the
explicit path to replace the file. Replace mode returns `not_found` with a
message stating that `replace` requires an existing target and that omitting
the flag creates a new file. Neither failure produces sibling-name suggestions;
that remains a read-only affordance. The tool description states both modes so
the schema itself teaches the contract.

## Risks / Trade-offs

- [Replace lowers wholesale clobber from many edits to one call] → no new
  authority (`edit`/`bash` already reach it); the explicit flag makes the
  intent auditable in the recorded attempt and result, and both guards fail
  closed on intent mismatch.
- [External process deletes or replaces the target between validation and the
  rename] → accepted and specified: the rename recreates the file, the same
  documented boundary `edit` has today, since mutations are ordered in the host
  process only and no guarantee extends past that boundary. No atomic
  identity-verifying publication primitive is built: `RENAME_EXCHANGE` is
  Linux-only, needs a native binding, and defends only a race that is already
  outside the shipped spec guarantee.
- [Models may set `replace: true` reflexively, making `file_exists`→replace the
  common path] → the `file_exists` message and description keep `edit` as the
  default for partial changes; the flag is for whole-file regeneration.
- [`replaced` adds a result field] → additive, model- and event-log-facing;
  no client or UI consumer reads the mutation result shape today.

## Migration Plan

None. The flag is additive, absent-flag behavior is byte-identical, and no
database, config, client, or receipt migration is involved. Rollback is
reverting the tool schema and the mutation branch; recorded `replaced` results
replay as stored under the existing fence.

## Open Questions

None — the four-outcome table in `proposal.md` fixes the contract.
