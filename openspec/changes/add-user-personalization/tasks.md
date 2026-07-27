## 1. Schema and tenant isolation

- [ ] 1.1 Add the `personalization` table to `apps/api/src/db/schema` (owner user id referencing `users.id` with cascade delete, `preferred_name`, `about`, `response_preferences`, `timezone`, `enabled`, timestamps) and export it from the schema index
- [ ] 1.2 Generate the migration with `pnpm --filter api db:generate`, then hand-append `FORCE ROW LEVEL SECURITY` and the owner policy over `current_setting('app.current_user_id', true)` with no public-read policy
- [ ] 1.3 Document the hand-edited migration in the `apps/api/AGENTS.md` migration-exceptions list
- [ ] 1.4 Add a schema spec asserting RLS is enabled and the expected columns/constraints exist, following `apps/api/src/db/schema/model-context.spec.ts`
- [ ] 1.5 Add cross-tenant and empty-identity negative cases to `apps/api/scripts/rls-test.sh` proving no other user's row and no public-path read is possible

## 2. Personalization module and caps

- [ ] 2.1 Create the `personalization` NestJS module with a repository that reads and upserts the authenticated owner's row inside `tenantDb.runAs`
- [ ] 2.2 Define the per-field caps as exported constants in the low-kilobyte range, and document the chosen numbers in `apps/api/AGENTS.md`
- [ ] 2.3 Implement a token-estimate helper for the rendered block (documented approximation; no tokenizer coupling) and unit-test it
- [ ] 2.4 Unit-test cap enforcement, IANA timezone validation, and that an absent row behaves identically to a disabled row

## 3. Template context allowlist

- [ ] 3.1 Extend the allowlist constant exported by `apps/api/src/instance-config/prompt-loader.ts` with the per-user paths `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.personalization.timezone`, `user.name`, `user.email` — names matching the API contract exactly, nothing renderable for `enabled`
- [ ] 3.2 Assert a template referencing a per-user path outside the allowlist fails startup naming the model id and path, indistinguishably from any other unknown identifier
- [ ] 3.3 Assert per-user paths are accepted at boot without resolving owner data, and that a template referencing none still loads
- [ ] 3.4 Add a conditional personalization block to `apps/api/src/prompts/chat-default.md` referencing no account-identity path, and update the packaged-default validation test
- [ ] 3.5 Assert the packaged default references neither `user.name` nor `user.email`, so a stock install transmits no account identity

## 4. Per-user context projection and bind

- [ ] 4.1 Build the per-user context as an explicit scalar projection; add a test asserting no personalization row, user row, or config object is reachable through any context path, naming `users.password` as the case that must stay unreachable
- [ ] 4.2 Omit absent values from the context entirely (rather than presenting empty strings) so `if`/`unless` evaluate correctly, and omit `user.personalization` wholly when disabled or when every field is empty
- [ ] 4.3 Read personalization plus the owner's `users.name`/`users.email` in one short `tenantDb.runAs` scope, with the account read explicitly filtered on the authenticated owner id since `users` has no RLS backstop; pass the projection into `resolveEffectiveContext` (`apps/api/src/runs/effective-context-resolver.ts`) so substitution precedes `promptHash`/`canonicalContent`/`contentHash`; call site is `apps/api/src/chats/chat-loop.service.ts`
- [ ] 4.4 Assert every per-user path renders nothing when `enabled` is false, including the account-identity paths
- [ ] 4.5 Assert a conditional block over `user.personalization` is omitted entirely for an owner who authored nothing, leaving the prompt byte-identical to the same template with that block removed
- [ ] 4.6 Assert authored text cannot forge the operator's surrounding structure, and that substituted owner text is not re-evaluated as a template
- [ ] 4.7 Integration-test that two owners running the same model each bind their own rendered values and neither appears in the other's snapshot
- [ ] 4.8 Integration-test that editing personalization after enqueue does not change the already-bound run, and that a retry reuses the bound snapshot

## 5. Bounded authority

- [ ] 5.1 Frame the rendered preferences as owner-authored delivery preferences of bounded authority that do not grant capabilities or override the instructions above them
- [ ] 5.2 Add a test asserting the bound advertised tool contract is byte-identical with and without personalization, including when preference text explicitly requests a non-allowlisted tool
- [ ] 5.3 Verify no personalization value is passed into `resolveAdvertisedTools` or any tool-gate input

## 6. Activation and cost reporting

- [ ] 6.1 Determine per configured model whether its resolved template references any per-user path, and expose that activation state
- [ ] 6.2 Assert an operator override referencing no per-user path boots successfully, executes runs normally, and reports inactive for that model while another model reports active
- [ ] 6.3 Include the token estimate for the current stored content in the personalization response

## 7. Compaction leak mitigation

- [ ] 7.1 Scope the compaction summarization instruction's `Constraints and Preferences` section to preferences stated by the user within the conversation
- [ ] 7.2 Update the affected compaction specs/tests for the new instruction wording
- [ ] 7.3 Integration-test that compaction of a run whose bound prompt contained personalization still produces a valid checkpoint and that the next run re-renders personalization from current stored values

## 8. API surface

- [ ] 8.1 Add `GET /api/v1/me/personalization` returning an explicit response type with an egress allowlist (stored fields, per-model activation, token estimate)
- [ ] 8.2 Add `PATCH /api/v1/me/personalization` with a class-validator DTO enforcing caps and timezone validity, applying only to the authenticated user
- [ ] 8.3 Assert identity comes solely from the authenticated session: a client-supplied user identifier is ignored or rejected, and unauthenticated requests are denied
- [ ] 8.4 Confirm both endpoints appear in the generated OpenAPI document with `@ApiProperty` nullability modeled explicitly
- [ ] 8.5 Assert no personalization content reaches operator logs or error responses on validation or render failure

## 9. Verification and documentation

- [ ] 9.1 Run `pnpm --filter api lint`, `typecheck`, and `test`, plus `apps/api/scripts/rls-test.sh`, and fix all findings
- [ ] 9.2 Document the per-user context paths, the gating and absence semantics (absent paths are omitted so conditionals work), activation semantics, caps, and the content policy in `apps/api/AGENTS.md`
- [ ] 9.3 Record the precedence ladder (operator prompt and tool/safety constraints > in-conversation instructions > authored personalization > future inferred memory) in the shipped documentation
- [ ] 9.4 Add the dated `CHANGELOG.md` entry in this same change, and update the research note's status line to point at this change
