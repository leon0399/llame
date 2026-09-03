# Coding standards

The correct change is the smallest one that fully solves the current task.

## Scope

- Touch only files and behavior required by the task. Nearby debt is a note.
- Add no unrequested feature, option, fallback, or cleanup.
- Match local style and boundaries. Do not extend a known violation or launch an
  unrelated cleanup.
- Delete prohibited speculative structure when the task already touches it and
  removal stays in scope; elsewhere, report it without expanding the diff.
- State assumptions before coding. If a simpler requirement preserves the
  outcome and deletes substantial complexity, propose it first.
- Regression risk follows lines touched. Prefer an isolated unit over threading
  a new path through shared code when both satisfy the task.

## Structure

- Reuse repository code, then platform/standard library, then installed
  dependencies. Add a dependency only when those fail.
- Duplicate twice. Extract at the third real occurrence only when callers change
  together and the extraction is smaller.
- Inline single-use helpers unless they name a real responsibility boundary.
- Prefer plain data and functions. Use a class for coupled state and behavior;
  use an interface for multiple implementations or a real external/test seam.
- Choose data shapes that make edge cases ordinary; do not add guards to
  compensate for a shape the task can simplify.
- Prefer composition to inheritance and one traceable path over pass-through
  layers.
- Inheritance deeper than one level is prohibited.
- Remove imports, parameters, functions, and flags orphaned by the change.
  Leave pre-existing dead code outside scope.
- Add no compatibility shim when nothing uses the old path.

Prohibited without a present need: one-implementation interfaces; factories,
registries, or plugin systems over a fixed set; single-caller config objects,
generics, or optional parameters; unused extension points; retries, caches,
metrics, logs, and feature flags.

## Complexity trip-wires

| Signal                      | Threshold |
| --------------------------- | --------: |
| Branching function length   | >40 lines |
| Parameters                  |        >4 |
| Nesting                     |        >3 |
| Hops to trace behavior      |        >4 |
| New files in a small change |        >2 |

These diagnose design. Do not split mechanically, raise thresholds, or hide
violations. Straight-line orchestration may remain long when extraction would
obscure order. If a direct implementation is several times shorter, replace the
larger one.

Complexity beyond rule-of-three extraction needs at least two current facts:
three callers change together; duplication caused a bug; an external boundary
exists; profiling proves a hot path; or tests need an otherwise unavailable
seam. Add only enough structure to resolve that evidence.

## Failure behavior and comments

- Handle real states; assert impossible ones.
- Preserve validation, security, accessibility, and data-loss prevention.
- Comments explain non-obvious reasons, not visible code.
- Prefer deletion. A feature should be as easy to remove as to add.

## Proof

Before coding, define a checkable outcome: failing test, reproducer, or command.
Test observable behavior at a real seam. A bug fix includes a test that fails
without it. Break the implementation when a test may be tautological; if the
test stays green, rewrite or delete it.

Reject the change if any answer is no:

1. Is it the smallest complete solution?
2. Does evidence show existing behavior still works?
3. Can any new layer, file, option, or dependency be removed?
4. Does every addition serve a current requirement?
5. Is unrelated code untouched?
6. Is the main path easy to trace?

Exceptions belong in the PR evidence. A new rule must replace or delete an old
one.
