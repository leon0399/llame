## 1. Proposal prerequisites

Delivery uses `$gh-stack` and, after proposal approval,
`$openspec-apply-change`. The intended stack is:

```text
master
  <- tool-prompt-templates/proposal
  <- tool-prompt-templates/runtime-context
  <- tool-prompt-templates/templates
  <- tool-prompt-templates/finalize
```

The proposal layer owns only these OpenSpec artifacts. Runtime-context owns
worker resolution, attempt lifecycle, system-only receipts, minimal committed
availability state, and coordinated storage cutover. Templates owns file
configuration, shared rendering, and conditional guidance. Finalize owns
canonical spec sync and archive. Implementation branches require approval of
the reviewed proposal; publication and merging require separate authority.

- [ ] 1.1 Link this change to the worker-binding decisions in #319 and establish the feature's tracking linkage before publication; verify the acceptance criteria reflect D1-D6 without persisted executable catalogs.
- [ ] 1.2 Review the complete draft with at least two independent reviewers and resolve verified substantive findings; run strict OpenSpec validation, Markdown lint, formatting, and diff checks, then obtain Leo's approval of the reviewed revision.
- [ ] 1.3 Before implementation, inspect the current stack/base and reconcile newly landed tool-search or skill-context work; verify neither can reintroduce stored tool definitions or failed-attempt context.

## 2. Runtime-context layer

- [ ] 2.1 Move effective prompt/catalog preparation from API acceptance into the executing worker; preserve accepted user/model/effort identity and single-flight. Test delayed execution, changed owner settings, a removed selected model, API-only operation without prompt mounts, and equivalent co-located/dedicated workers.
- [ ] 2.2 Add a fresh claim/reclaim attempt identity and tenant-scoped fencing for receipts, invocation admission, and final publication. Test stale workers after reclaim, competing completion, owner isolation, and existing native uncertain-effect recovery; fresh rendering must not authorize replay of a possibly executed mutation.
- [ ] 2.3 Replace combined snapshots with immutable system-only receipts per prepared attempt and minimal successful-turn id/state records. Generate a migration with forced RLS that preserves chats/system text, converts only observed successful historical availability, and removes catalog/schema/description/combined-hash storage. Test fresh/upgraded databases, empty versus unobserved state, tenant denial, and absence of catalog payloads in tables, events, metadata, and queue messages.
- [ ] 2.4 Bind native tools to trusted runtime id/schema/classification/executor authority and MCP tools to admitted in-memory source declarations. Test native identity rejection, MCP disconnect/schema/description drift within an attempt, and fresh discovery on retry without reconstructing tools from receipts.
- [ ] 2.5 Stage attempt-generated reminders and compare current availability with the preceding successful turn. Atomically publish only the winning assistant/context parts, injected-item record, id/state baseline, and Run completion. Test failure after preparation, cancellation, terminal failure, worker handoff, unchanged ids/states with changed descriptions, and the failed-unavailable/retried-available example.
- [ ] 2.6 Keep failed-attempt output for operational/UI purposes only and exclude it from retry input, later model history, recall, and compaction. Test mixed successful/failed tool calls inside a successful attempt separately from whole-attempt failure, preserving original user parts and committed order.
- [ ] 2.7 Stage digest baseline/told-set/appends and compaction-derived context state with the winning attempt; recheck sharing before provider I/O and account for actual disclosure through either prompt surface. Test failed initialization, stale epoch publication, consent changes before/after preparation, tool-only digest rendering, and unchanged temporal-anchor semantics.
- [ ] 2.8 Preserve same-attempt compaction's in-memory prompt/declarations. For later transition compaction, use the successful source model/effort and system receipt without tool declarations; test actual request-size budgeting, tool execution disabled, failed-history exclusion, and no historical-catalog reconstruction.
- [ ] 2.9 Adapt receipt API, generated clients, and the existing receipt UI to owner-scoped system-only attempt receipts, including pending/not-produced states. Test queued owned Run versus non-owner 404, immutable failed/successful receipts, no tool payloads/private paths, and existing UI inspection flows.
- [ ] 2.10 Verify this layer with relevant API/web lint, typecheck, unit/coverage, database integration, built-runtime, and receipt UI tests; run migration and OpenAPI consistency checks. Document backup, acceptance pause/drain, coordinated API/worker cutover, and backup-required rollback without resetting live chats.

## 3. Templates layer

- [ ] 3.1 Move all seven llame-owned descriptions to Markdown and remove their inline strings. Change the Nest asset glob to `prompts/**/*.md` and extend `prompt-built-runtime.contract.ts` to render all seven from built output; compare default text before intentional guidance changes.
- [ ] 3.2 Add `tools.promptFiles` and `models[].toolPromptFiles` using the existing prompt loader. Test per-tool precedence, null/absent entries, empty maps, shared relative paths, shadowed/disabled-file validation, restart-only reload, and invalid/missing/MCP/wildcard override targets.
- [ ] 3.3 Extend the shared validator/projection with conditional-only `tools.<exact-id>`; retain all existing safe model/owner/chat/temporal variables. Test known/unknown/disabled/offline targets including unconfigured MCP servers, exact provider-safe ids, traversal/prototype rejection, forbidden direct output/iteration, and non-recursive owner values.
- [ ] 3.4 Admit the attempt catalog before rendering both surfaces from one context; keep rendered declarations only in memory. Test membership independent of permissions, shared variable sanitization, two-owner isolation, settings changed between retries, and fixed context across steps of one attempt.
- [ ] 3.5 Separate boot syntax validation from actual nonempty-render validation. Test a valid unknown-tool conditional that does not crash worker startup and a mixed-membership empty render that fails the accepted attempt before provider I/O, without dropping a tool or deleting the accepted Run/message.
- [ ] 3.6 Gate Bash-to-edit and search-to-conversation-read guidance and audit other migrated cross-tool advice. Test both branches and preserved safety/result bounds; do not modify tool-result producers, argument schemas, or opaque MCP descriptions.
- [ ] 3.7 Update config schema/examples, template variable documentation, operator restart/cutover procedures, receipt limitations, and changelog. Load examples against real files and verify no new feature-check namespace or historical tool-description inspection claim.
- [ ] 3.8 Verify the integrated feature with focused tests plus repository lint, typecheck, coverage/integration checks, sequential API and affected web builds, OpenAPI consistency, strict OpenSpec validation, Markdown lint, formatting, and diff checks. Publish only with authority, then complete self-review and the repository's ready-PR monitoring contract.

## 4. Finalize layer

- [ ] 4.1 After implementation and delivery gates pass, run `$openspec-sync-specs` for every capability present in this change; verify intended renamed/removed requirements and preservation of unrelated canonical scenarios, then run strict spec/all validation.
- [ ] 4.2 Record completed implementation/verification tasks and run `$openspec-archive-change`; verify archived artifacts exist and the active change is absent.
- [ ] 4.3 Run strict spec/all validation, Markdown lint, formatting, and diff checks on the finalize layer; verify stack bases and tracking/publication state before handoff. Merge remains subject to Leo's explicit permission.
