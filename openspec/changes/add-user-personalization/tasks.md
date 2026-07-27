## 1. Schema and tenant isolation

- [ ] 1.1 Add the `personalization` table to `apps/api/src/db/schema` (owner user id referencing `users.id` with cascade delete, `display_name`, `about`, `response_preferences`, `timezone`, `enabled`, timestamps) and export it from the schema index
- [ ] 1.2 Generate the migration with `pnpm --filter api db:generate`, then hand-append `FORCE ROW LEVEL SECURITY` and the owner policy over `current_setting('app.current_user_id', true)` with no public-read policy
- [ ] 1.3 Document the hand-edited migration in the `apps/api/AGENTS.md` migration-exceptions list
- [ ] 1.4 Add a schema spec asserting RLS is enabled and the expected columns/constraints exist, following `apps/api/src/db/schema/model-context.spec.ts`
- [ ] 1.5 Add cross-tenant and empty-identity negative cases to `apps/api/scripts/rls-test.sh` proving no other user's row and no public-path read is possible

## 2. Personalization module and caps

- [ ] 2.1 Create the `personalization` NestJS module with a repository that reads and upserts the authenticated owner's row inside `tenantDb.runAs`
- [ ] 2.2 Define the per-field caps as exported constants in the low-kilobyte range, and document the chosen numbers in `apps/api/AGENTS.md`
- [ ] 2.3 Implement a token-estimate helper for the rendered block (documented approximation; no tokenizer coupling) and unit-test it
- [ ] 2.4 Unit-test cap enforcement, IANA timezone validation, and that an absent row behaves identically to a disabled row

## 3. Prompt expression support

- [ ] 3.1 Extend `assertSupportedPromptExpressions` in `apps/api/src/instance-config/prompt-loader.ts` to accept `${personalization}` while still rejecting all other unknown expressions
- [ ] 3.2 Leave `${personalization}` unresolved by `renderPrompt` at boot, and assert in `prompt-loader.spec.ts` that a prompt containing it loads successfully with the token retained
- [ ] 3.3 Assert that a prompt omitting `${personalization}` still loads and does not fail startup
- [ ] 3.4 Add `${personalization}` to `apps/api/src/prompts/chat-default.md` as a named section, and update the packaged-default validation test

## 4. Render and bind

- [ ] 4.1 Implement the named-section renderer, escaping every substituted value with the `escapeXmlAttribute` helper pattern from `apps/api/src/chats/model-context-part.ts`
- [ ] 4.2 Render an empty section (not a bare header) when personalization is absent, empty, or disabled, and assert the resulting prompt stays valid and non-empty
- [ ] 4.3 Substitute the rendered section into the effective prompt at effective-context-snapshot bind time, inside the chat owner's tenant transaction, before hashing
- [ ] 4.4 Add a unit test proving authored text containing the section's own markup or a closing delimiter is escaped and cannot forge structure
- [ ] 4.5 Integration-test that two owners with different personalization running the same model each bind their own rendered content and neither appears in the other's snapshot
- [ ] 4.6 Integration-test that editing personalization after enqueue does not change the already-bound run, and that a retry reuses the bound snapshot

## 5. Bounded authority

- [ ] 5.1 Frame the rendered preferences as owner-authored delivery preferences of bounded authority that do not grant capabilities or override the instructions above them
- [ ] 5.2 Add a test asserting the bound advertised tool contract is byte-identical with and without personalization, including when preference text explicitly requests a non-allowlisted tool
- [ ] 5.3 Verify no personalization value is passed into `resolveAdvertisedTools` or any tool-gate input

## 6. Activation and cost reporting

- [ ] 6.1 Determine per configured model whether its resolved prompt contains `${personalization}`, and expose that activation state
- [ ] 6.2 Assert an operator override lacking the placeholder boots successfully, executes runs normally, and reports inactive for that model while another model reports active
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
- [ ] 9.2 Document the placeholder vocabulary, activation semantics, caps, and content policy in `apps/api/AGENTS.md`
- [ ] 9.3 Record the precedence ladder (operator prompt and tool/safety constraints > in-conversation instructions > authored personalization > future inferred memory) in the shipped documentation
- [ ] 9.4 Add the dated `CHANGELOG.md` entry in this same change, and update the research note's status line to point at this change
