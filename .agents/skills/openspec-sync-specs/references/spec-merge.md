# Spec merge reference

Conditional companion to the `openspec-sync-specs` workflow — routine ADDED and MODIFIED merges against existing specs follow that workflow's step 4 and never need this file. Read the section a case needs, once:

- **File shapes** — when the canonical delta or main-spec format is unfamiliar.
- **Merge semantics** — with any case below, and whenever a selected delta carries a REMOVED or RENAMED operation.
- **Missing main spec** — when a delta meets a spec the project does not have.
- **Retirement guards** — when removing requirements may leave a capability with none.
- **After the merge** — the checks that close any run that consulted this file.

Once read for a case, keep it for the rest of the run; do not re-read it for each capability while the file and deltas are unchanged. The `openspec-sync-specs` workflow owns the run; this file owns these details.

## File shapes

A delta spec carries operations as sections:

```markdown
# Spec Delta

## Purpose <- only on a delta that introduces a brand-new capability

## ADDED Requirements

### Requirement: New Feature

The system SHALL do something new.

#### Scenario: Basic case

- **WHEN** user does X
- **THEN** system does Y

## MODIFIED Requirements

### Requirement: Existing Feature

The system SHALL keep doing the existing thing, now also handling A.

#### Scenario: Scenario the main spec already has

- **WHEN** user does X
- **THEN** system does Y

#### Scenario: New scenario to add

- **WHEN** user does A
- **THEN** system does B

## REMOVED Requirements

### Requirement: Deprecated Feature

## RENAMED Requirements

- FROM: `### Requirement: Old Name`
- TO: `### Requirement: New Name`
```

A main spec has one requirements section and no delta operation headers:

```markdown
# <capability> Specification

## Purpose

Short description of what this capability does and why it exists.

## Requirements

### Requirement: New Feature

The system SHALL do something new.

#### Scenario: Basic case

- **WHEN** user does X
- **THEN** system does Y
```

## Merge semantics

- **ADDED**: add a requirement the main spec lacks. When one with that name already exists, update it to match the delta — an implicit MODIFIED.
- **MODIFIED**: find the requirement and fold in the delta's description and scenario changes. A MODIFIED block carries the whole requirement, body plus every scenario that survives the change, because `openspec validate` and `openspec archive` both reject one that drops a scenario the main spec still has. Merge rather than overwrite: keep scenarios and wording the delta does not mention.
- **REMOVED**: remove the entire requirement block. Deleting the spec itself has guards below.
- **RENAMED**: find the FROM requirement and rename it to TO; the old name must be absent afterwards.
- **`## Purpose` in a delta**: only seeds a brand-new main spec. An existing main spec's Purpose is authoritative — leave it alone; this is what `openspec archive` does.
- Keep anything the delta does not mention, in the main spec's existing order, and use judgment where a delta is imprecise. A delta file is never copied into a main spec as-is.

The operation is idempotent: applying the same delta again must leave the same specs.

## Missing main spec (new capability)

The main spec is an _output_ of the sync, not an input. Match what `openspec archive` does:

- Only ADDED requirements may create it. MODIFIED or RENAMED with no current version → stop that capability and report that a new spec can only be created from ADDED requirements; never invent the missing requirement.
- REMOVED-only: when the change's `.openspec.yaml` declares `retire_capabilities: true`, the capability is already retired — count it as synced and warn that there is nothing left to remove; do not recreate the spec. Without the marker, report the sync as blocked; `openspec archive` refuses it with `Spec must have at least one requirement`.
- Empty delta: no operations to apply; report it as blocked.
- Otherwise create `<planningHome.root>/openspec/specs/<capability-path>/spec.md` with the `# <capability> Specification` title, a Purpose (the delta's `## Purpose` body verbatim when present, otherwise a brief TBD placeholder), and one `## Requirements` section holding the ADDED requirements. When the delta also carries REMOVED requirements, warn that those removals are ignored — with no main spec there was nothing to remove. Never write an empty `## Requirements`.

## Retirement guards

Delete a capability's `spec.md` — and its directory once nothing else is left in it — only when ALL of these hold:

1. removing the requirements selected this run left no requirement blocks;
2. the rest of the spec is well-formed (it still has a `## Purpose`);
3. the main spec was not already empty before this run — if you removed nothing, change nothing;
4. every other nonblank line in the whole file is accounted for as the title, the Purpose, the Requirements header, or a canonical requirement's statement, scenarios, or fenced examples;
5. the change's `.openspec.yaml` declares `retire_capabilities: true`;
6. the `spec.md` resolves inside the real specs root — do not follow a capability-directory symlink to delete an external file.

When removing the selected requirements would leave no requirement blocks and any guard fails, do not modify the main spec: stop that capability, report the blocking condition, and say how to resolve it. When only the marker is missing, name that too — it is the one thing the user can add to make the retirement go through.

Deleting the file also deletes its `## Purpose`; any other section blocks retirement. Name Purpose when reporting the retirement. Offer a pasteable `git checkout` only when the spec lived in the caller's checkout; otherwise give checkout-scoped recovery guidance.

## After the merge

- Main specs must pass `openspec validate --specs` and must never contain `## ADDED`, `## MODIFIED`, `## REMOVED`, or `## RENAMED` sections.
- A capability counts as synced only once its main spec reflects the delta with unrelated scenarios intact — never report a merge the validation or the delta comparison does not support.
