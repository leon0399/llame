## 1. Proposal and delivery prerequisites

Delivery uses `$gh-stack` and, after proposal approval,
`$openspec-apply-change`. The exact stack is:

```text
master
  <- tool-prompt-templates/proposal
  <- tool-prompt-templates/source-bindings
  <- tool-prompt-templates/templates
  <- tool-prompt-templates/finalize
```

The proposal layer owns only these OpenSpec artifacts. Source-bindings owns
immutable source-contract metadata and worker verification. Templates owns the
complete configuration/rendering feature and closes the eventual tracking issue.
Finalize owns canonical spec sync, completion records, and archive. Create
implementation branches only after approval of the reviewed proposal revision.

- [ ] 1.1 On the proposal layer, link a tracking issue before publication and implementation; verify its acceptance matches D1-D6 and identify the templates layer as the issue-closing owner.
- [ ] 1.2 On the proposal layer, review the complete draft independently, validate it with `openspec validate tool-prompt-templates --strict`, Markdown lint, formatting, and diff checks; obtain approval of the reviewed revision before application.
- [ ] 1.3 Before source-bindings, reconcile any newly landed tool-search or skill-context changes with D3-D4 and confirm native blockers; verify the checked-out branch/base with `gh stack view --json`.

## 2. Source-bindings layer

- [ ] 2.1 Add private canonical source-declaration hashes to snapshot input, persistence, equality, and content identity, including an explicit empty map for new Runs; verify equal rendered content with different source contracts does not reuse a snapshot.
- [ ] 2.2 Generate an additive migration preserving nullable metadata on historical rows and existing forced RLS/owner binding; verify fresh and upgraded test databases, historical receipt reads, and negative cross-owner snapshot access.
- [ ] 2.3 Bind code-owned executors using their exact id, schema, source hash, classification, and existing native gates while sending stored descriptions; verify queued/retried Runs preserve rendered text and missing/extra/malformed source bindings or schema/source drift fail before provider I/O.
- [ ] 2.4 Preserve MCP full-declaration matching and unavailable-executor behavior; verify server description/schema drift and disconnects do not gain the code-owned wording exception.
- [ ] 2.5 Verify the source-bindings layer with API lint, typecheck, coverage, integration tests, build, migration checks, Markdown lint, formatting, and diff checks; use publication authority and the ready-PR monitoring contract before advancing its delivery state.

## 3. Templates layer

- [ ] 3.1 Move all seven llame-owned descriptions to packaged Markdown assets and remove their inline source strings; verify production build output contains every file and baseline descriptions preserve their content before intentional conditional guidance edits.
- [ ] 3.2 Add `tools.promptFiles` and `models[].toolPromptFiles` configuration/schema/loading using the existing prompt loader; verify per-key precedence, null/empty maps, shared relative paths, restart behavior, disabled/shadowed validation, and rejection of missing files, unknown ids, MCP ids, and wildcard keys.
- [ ] 3.3 Extend the shared validator and projection with conditional-only exact tool predicates and reuse every existing variable/sanitizer; verify all current projection kinds in both prompt surfaces, configured-offline MCP predicates, unknown native ids, traversal, direct emission, iteration restrictions, and non-recursive owner values.
- [ ] 3.4 Admit candidates before rendering, then construct final declarations and availability hashes from one per-Run context; verify system/description predicates agree and two concurrent owners cannot share rendered text through the registry or caches.
- [ ] 3.5 Add startup probes and atomic runtime empty-render rejection; verify a mixed-tool case that passes startup diagnostics commits no user message, snapshot binding, or Run and makes no provider call.
- [ ] 3.6 Gate existing cross-tool description advice, including Bash-to-edit and search-to-conversation-read; verify present/absent branches preserve independent safety and bounded-result statements without changing tool-result producers.
- [ ] 3.7 Exercise API acceptance through worker execution and receipt retrieval with owner/model/catalog changes, delayed execution, permitted retry, and operator-file reload; verify exact rendered text, matching final hashes, no private path/source-map disclosure, and negative owner isolation.
- [ ] 3.8 Update configuration examples, schema authoring documentation, operator cutover/restart instructions, and changelog; verify examples load with real prompt files and document the source-bindings drain/rollback procedure without resetting user data.
- [ ] 3.9 Verify the complete feature with API lint, typecheck, coverage, integration tests, build, migration checks, OpenAPI regeneration consistency, Markdown lint, formatting, and diff checks; publish only with authority, then self-review and complete ready-PR monitoring. This layer closes the tracking issue after its full acceptance is satisfied.

## 4. Finalize layer

- [ ] 4.1 After implemented layers pass their checks and delivery gates, run `$openspec-sync-specs` for the four capability deltas; verify no existing scenarios were lost and strict spec/all validation passes.
- [ ] 4.2 Confirm all implementation tasks are complete and recorded, then run `$openspec-archive-change`; verify the archived proposal, design, specs, and checked tasks exist and the active change is absent.
- [ ] 4.3 Run strict spec/all validation, Markdown lint, formatting, and diff checks on the finalize layer; verify stack bases, publication/review state, and tracking updates before handoff. Merge remains subject to Leo's explicit permission.
