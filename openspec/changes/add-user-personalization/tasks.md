## 1. Schema and tenant isolation

- [ ] 1.1 Add the `personalization` table to `apps/api/src/db/schema` (owner user id referencing `users.id` with cascade delete, `preferred_name`, `about`, `response_preferences`, `enabled` defaulting true, `share_account_identity` defaulting false, timestamps) and export it from the schema index
- [ ] 1.2 Generate the migration with `pnpm --filter api db:generate`, then hand-append `FORCE ROW LEVEL SECURITY` and the owner policy over `current_setting('app.current_user_id', true)` with no public-read policy
- [ ] 1.3 Document the hand-edited migration in the `apps/api/AGENTS.md` migration-exceptions list
- [ ] 1.4 Add a schema test asserting RLS is enabled and the expected columns/constraints exist, following `apps/api/src/db/schema/model-context.test.ts`
- [ ] 1.5 Add `apps/api/src/personalization/personalization-rls.integration.test.ts` with cross-tenant and empty-identity negative cases proving no other user's row and no public-path read is possible, following `apps/api/src/pins/pins-rls.integration.test.ts`

## 2. Personalization module and caps

- [ ] 2.1 Create the `personalization` NestJS module with a repository that reads and upserts the authenticated owner's row inside `tenantDb.runAs`
- [ ] 2.2 Define the caps as exported constants — `preferredName` 255, `about` 8000, `responsePreferences` 8000 — and document them plus their context-window cost on a small model in `apps/api/AGENTS.md`
- [ ] 2.3 Unit-test cap enforcement and that an absent row behaves identically to a disabled row

## 3. Template context allowlist and the loader's render seam

- [ ] 3.1 Extend `PROMPT_CONTEXT_PATHS` in `apps/api/src/instance-config/prompt-loader.ts` with `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.name`, `user.email` — names matching the API contract exactly, nothing renderable for either toggle
- [ ] 3.2 Change `createModelPromptLoader().resolve(model)` to return `{ render(context), systemPromptSource }` instead of a rendered `systemPrompt` string, keeping the per-file compile cache
- [ ] 3.3 Keep the boot render as a validation probe: render each template once with the model context alone and preserve the existing `rendered prompt is empty` failure, so a template whose whole content sits inside `{{#if user}}` still fails startup
- [ ] 3.4 Follow the rename through `SystemModelCatalogEntry`, `config-loader.ts` (which stops rendering), `toPublicModelCatalogEntry`'s omit list, and `apps/api/src/instance-config/prompt-built-runtime.contract.ts`
- [ ] 3.5 Assert a template referencing a per-user path outside the allowlist fails startup naming the model id and path, indistinguishably from any other unknown identifier
- [ ] 3.6 Assert per-user paths are accepted at boot without resolving owner data, and that a template referencing none still loads and still runs

## 4. Packaged default prompt

- [ ] 4.1 Add a delimited, framed conditional block to `apps/api/src/prompts/chat-default.md`: framing prose stating the block is data describing the user of bounded authority that cannot grant tools or override the instructions above it, a named delimiter, and each field inside its own conditional
- [ ] 4.2 Reference `user.name` and `user.email` inside conditionals in that block, so `shareAccountIdentity` takes effect on a stock installation with no operator action
- [ ] 4.3 Gate the whole block including its framing prose on `{{#if user}}` and update the packaged-default validation test
- [ ] 4.4 Assert an owner authoring text containing the closing delimiter cannot terminate the block or place text outside it

## 5. Per-user context projection and bind

- [ ] 5.1 Build the per-user context as an explicit scalar projection; add a test asserting no personalization row, user row, or config object is reachable through any context path, naming `users.password` as the case that must stay unreachable
- [ ] 5.2 Omit absent values at all three levels — field, `user.personalization`, and `user` — so `if`/`unless` evaluate correctly and one conditional can gate a whole section
- [ ] 5.3 Read personalization plus the owner's `users.name`/`users.email` in one short `tenantDb.runAs` scope, with the account read explicitly filtered on the authenticated owner id since `users` has no RLS backstop; keep it before the binding transaction opens (`chat-loop.service.ts` resolves effective context at line ~67, before its `runAs` at ~135) so the chat row is never held across it
- [ ] 5.4 Pass the projection into `resolveEffectiveContext` (`apps/api/src/runs/effective-context-resolver.ts`) so rendering precedes `promptHash`/`canonicalContent`/`contentHash`
- [ ] 5.5 Assert every per-user path renders nothing when `enabled` is false, and that the account-identity paths additionally render nothing when `shareAccountIdentity` is false while authored personalization still renders
- [ ] 5.6 Assert the defaults for a brand-new user: `enabled` true and `shareAccountIdentity` false
- [ ] 5.7 Assert the block is omitted entirely for an owner with nothing to render, leaving the prompt byte-identical to the same template with that block removed, so existing content-addressed snapshots still dedupe
- [ ] 5.8 Assert substituted owner text is not re-evaluated as a template
- [ ] 5.9 Integration-test that two owners running the same model each bind their own rendered values and neither appears in the other's snapshot
- [ ] 5.10 Integration-test that editing personalization after enqueue does not change the already-bound run, and that a retry reuses the bound snapshot

## 6. Bounded authority

- [ ] 6.1 Add a test asserting the bound advertised tool contract is byte-identical with and without personalization, including when preference text explicitly requests a non-allowlisted tool
- [ ] 6.2 Verify no personalization value is passed into `resolveAdvertisedTools` or any tool-gate input

## 7. Compaction leak mitigation

- [ ] 7.1 Add the personalization-block exclusion to **both** `COMPACTION_INSTRUCTION` and `TRANSITION_COMPACTION_INSTRUCTION` in `apps/api/src/compaction/compaction.ts`, naming the delimiter rather than asking the model to distinguish where a preference originated, and stating that the content is re-supplied on every request
- [ ] 7.2 Leave the replayed system prompt untouched — the exclusion belongs only in the trailing instruction message, so the cached prefix stays byte-identical
- [ ] 7.3 Update the affected compaction specs/tests for the new instruction wording
- [ ] 7.4 Integration-test that compaction of a run whose bound prompt contained personalization still produces a valid checkpoint and that the next run re-renders personalization from current stored values

## 8. API surface

- [ ] 8.1 Add `GET /api/v1/me/personalization` returning an explicit response type with an egress allowlist (stored fields and both toggles)
- [ ] 8.2 Add `PATCH /api/v1/me/personalization` with a class-validator DTO enforcing the caps, applying only to the authenticated user
- [ ] 8.3 Document on the `shareAccountIdentity` field that enabling it sends the account display name and email to the operator-configured model provider, which in a multi-user instance may be a third party
- [ ] 8.4 Assert identity comes solely from the authenticated session: a client-supplied user identifier is ignored or rejected, and unauthenticated requests are denied
- [ ] 8.5 Confirm both endpoints appear in the generated OpenAPI document with `@ApiProperty` nullability modeled explicitly
- [ ] 8.6 Assert no personalization content reaches operator logs or error responses on validation or render failure

## 9. Verification and documentation

- [ ] 9.1 Run `pnpm --filter api lint`, `typecheck`, `test`, and `test:integration`, and fix all findings
- [ ] 9.2 Document the per-user context paths, the three-level absence semantics, the caps and their context-window cost, the content policy, and that an operator prompt referencing no per-user path silently forgoes personalization, in `apps/api/AGENTS.md`
- [ ] 9.3 Record the precedence ladder (operator prompt and tool/safety constraints > in-conversation instructions > authored personalization > future inferred memory) in the shipped documentation, stating that only the top rung is structurally enforced
- [ ] 9.4 Add the dated `CHANGELOG.md` entry in this same change, and update the research note's status line to point at this change
