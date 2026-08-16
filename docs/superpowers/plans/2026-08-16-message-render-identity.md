# Stable Message Render Identity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

Version: v3

**Goal:** Eliminate the draft-to-persisted chat remount and make live-to-durable message adoption preserve UI state while retaining durable IDs for API actions.

**Architecture:** Mount every conversation on the canonical `/chat/[id]` leaf before `ChatPage` exists. Model draft recovery as a small pure state machine, use the existing TanStack history query as the bounded recovery seam, and join live/durable assistant render identity by Run ID. Vitest proves each domain transition; the existing Playwright MCP acceptance holds the real history response and proves the composition.

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query 5, AI SDK 6, Vitest, Playwright, Oxlint, TypeScript.

**Design authority:** `docs/superpowers/specs/2026-08-16-message-render-identity-design.md` v5.

**Resource rule:** Run commands in the foreground. Keep Playwright at its configured one worker and set `NODE_OPTIONS=--max-old-space-size=2048` for browser/build commands. Never start a watcher or a background shell process.

---

## Chunk 1: Independent domain seams

### Task 1: Define draft-route semantics without changing production routing

**Files:**

- Create: `apps/web/lib/services/chat/draft-route.ts`
- Create: `apps/web/lib/services/chat/draft-route.test.ts`

- [ ] **Step 1: Write the failing tests**

  Add table-driven cases for exact scalar parsing:

  ```ts
  expect(draftPhaseFromSearchParam("fresh")).toBe("fresh");
  expect(draftPhaseFromSearchParam("sent")).toBe("sent");
  expect(draftPhaseFromSearchParam(undefined)).toBeNull();
  expect(draftPhaseFromSearchParam("unknown")).toBeNull();
  expect(draftPhaseFromSearchParam(["fresh"])).toBeNull();
  ```

  Add path cases:

  ```ts
  expect(draftChatPath(CHAT_ID, "fresh")).toBe(`/chat/${CHAT_ID}?draft=fresh`);
  expect(draftChatPath(CHAT_ID, null)).toBe(`/chat/${CHAT_ID}`);
  ```

- [ ] **Step 2: Verify RED**

  ```bash
  pnpm --filter web exec vitest run lib/services/chat/draft-route.test.ts
  ```

  Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal module**

  Export only:

  ```ts
  export type DraftPhase = "fresh" | "sent";
  export function draftPhaseFromSearchParam(
    value: string | string[] | undefined,
  ): DraftPhase | null;
  export function draftChatPath(
    chatId: string,
    phase: DraftPhase | null,
  ): `/chat/${string}`;
  ```

  The parser accepts exact scalar values only. The path helper uses
  `URLSearchParams`, not manual query concatenation. Do not change either page
  yet; this commit must leave current product behavior intact.

- [ ] **Step 4: Verify GREEN and commit**

  Re-run the focused test and `pnpm --filter web typecheck`, then commit:

  ```text
  refactor(web): define canonical draft routes
  ```

### Task 2: Preserve strict history and add owner-scoped draft probing

**Files:**

- Modify: `apps/web/lib/services/chat/server.test.ts`
- Modify: `apps/web/lib/services/chat/server.ts`

- [ ] **Step 1: Write the failing server tests**

  Extend the existing suite with real `Response` objects and mocked Next
  navigation:

  - `fetchInitialChatMessages(id)` still calls `notFound()` on 404;
  - `fetchDraftChatMessages(id, "fresh")` returns `null` on owner-scoped 404;
  - both `fresh` and `sent` 401s preserve the full marker in
    `/login?callbackUrl=${encodeURIComponent(draftChatPath(id, phase))}`;
  - a successful empty chat returns `{ messages: [], compaction: null }`, not
    `null`, so existing-empty and missing remain distinct.

- [ ] **Step 2: Verify RED**

  ```bash
  pnpm --filter web exec vitest run lib/services/chat/server.test.ts
  ```

  Expected: FAIL because the draft-aware contract and callback preservation do
  not exist.

- [ ] **Step 3: Implement one shared fetch pipeline**

  Keep `fetchInitialChatMessages(chatId): Promise<ChatHistory>` strict. Add:

  ```ts
  export function fetchDraftChatMessages(
    chatId: string,
    phase: DraftPhase,
  ): Promise<ChatHistory | null>;
  ```

  Internally distinguish `404 -> notFound()` from `404 -> null` without
  duplicating auth, per-page timeout, pagination, or JSON mapping. Only the
  initial page may be absent; once it succeeds, subsequent pages use the strict
  path. Preserve the current 5-second timeout around response-body reading.

- [ ] **Step 4: Verify GREEN and commit**

  Run the server and draft-route suites plus web typecheck. Commit:

  ```text
  refactor(web): probe draft chat history safely
  ```

### Task 3: Own bounded sent-draft recovery in the query layer

**Files:**

- Modify: `apps/web/lib/services/chat/queries.test.ts`
- Modify: `apps/web/lib/services/chat/queries.ts`

- [ ] **Step 1: Write the failing query-option tests**

  Pin the public seam rather than React internals:

  - ordinary message queries retain existing/default retry behavior;
  - sent-draft recovery exposes a bounded TanStack retry count;
  - a real ky `HTTPError` with status 404 is classified as owner-scoped
    absence;
  - 401, 500, and non-HTTP errors are not classified as absence.

- [ ] **Step 2: Verify RED**

  ```bash
  pnpm --filter web exec vitest run lib/services/chat/queries.test.ts
  ```

  Expected: FAIL because the recovery option and error classifier do not exist.

- [ ] **Step 3: Extend the existing query abstraction**

  Add a `recoverSentDraft` option to `useChatMessagesQuery` and the shared query
  options factory. When true, use TanStack's built-in bounded retry option; do
  not write a timer, loop, poller, or request wrapper. Export one narrow
  `isChatHistoryMissing(error: unknown)` classifier using ky `HTTPError` and
  status 404. Preserve raw errors so 401/5xx/network remain distinguishable.

- [ ] **Step 4: Verify GREEN and commit**

  Run the focused query suite and web typecheck. Commit:

  ```text
  refactor(web): expose sent draft history recovery
  ```

### Task 4: Pin live-to-durable identity and adoption

**Files:**

- Modify: `apps/web/lib/services/chat/history.test.ts`
- Modify: `apps/web/lib/services/chat/history.ts`

- [ ] **Step 1: Write failing pure identity tests**

  Replace count-only `shouldAdoptServerHistory` inputs with readonly message
  lists. Add cases for:

  - `ready`, equal length, final live assistant ID equals final durable
    `metadata.usage.runId` -> adopt;
  - equal length but different Run ID -> reject;
  - same Run ID at a non-final assistant position -> reject;
  - after adoption, durable message ID plus matching metadata -> reject;
  - existing longer-ready, equal-error, shorter, submitted, and streaming
    behavior remains;
  - `messageRenderKey(liveAssistant) === messageRenderKey(durableAssistant)`;
  - user and legacy assistant keys remain message-ID based.

- [ ] **Step 2: Verify RED**

  ```bash
  pnpm --filter web exec vitest run lib/services/chat/history.test.ts
  ```

  Expected: FAIL because the predicate takes counts and no render-key helper
  exists.

- [ ] **Step 3: Implement the minimal domain functions**

  Equal `ready` adoption uses only the exact final-assistant Run-ID relation
  from the v5 design. Add:

  ```ts
  export function messageRenderKey(
    message: Pick<UIMessage, "id" | "role" | "metadata">,
  ): string;
  ```

  Prefix role, and use `runIdFromMessageMetadata` only for assistants. Do not
  change `ChatPage` in this task.

- [ ] **Step 4: Verify GREEN and commit**

  Run the focused history suite and web typecheck. Commit:

  ```text
  refactor(web): define durable message identity
  ```

## Chunk 2: Architectural cutover

### Task 5: Prove RED, then cut over to one route and one session owner

**Files:**

- Create: `apps/web/app/(chat)/page.test.ts`
- Create: `apps/web/app/(chat)/chat/[id]/page.test.ts`
- Create: `apps/web/lib/services/chat/draft-session.ts`
- Create: `apps/web/lib/services/chat/draft-session.test.ts`
- Modify: `apps/web/app/(chat)/page.tsx`
- Modify: `apps/web/app/(chat)/chat/[id]/page.tsx`
- Modify: `apps/web/app/(chat)/components/chat-page.tsx`
- Modify: `apps/web/app/(chat)/components/chat-page.models.test.tsx`
- Modify: `apps/web/app/(chat)/components/chat-page.compaction.test.tsx`
- Delete: `apps/web/app/(chat)/components/chat-page.hydration.test.ts`
- Modify: `e2e/web/chat/mcp-tool.spec.ts`

- [ ] **Step 1: Write the page-level redirect RED**

  In the server-page Vitest, spy on `crypto.randomUUID`, mock
  `next/navigation.redirect`, call the page, and require the exact
  `/chat/:uuid?draft=fresh` destination. Run:

  ```bash
  pnpm --filter web exec vitest run 'app/(chat)/page.test.ts'
  ```

  Expected: FAIL because `/` still renders `ChatPage`.

- [ ] **Step 2: Write and run the browser RED before production edits**

  Update the existing MCP test first:

  - require `/chat/:uuid?draft=fresh` before the composer is usable;
  - retain the UUID and install a route for the exact chat-history GET;
  - `route.fetch()` the real response, signal its existence, and hold
    `route.fulfill()` behind a test-local promise;
  - after live settlement, open the modal, release history, await response plus
    two `requestAnimationFrame` callbacks, and require the same modal to remain
    visible/closable;
  - require clean `/chat/:uuid`; retain reload and fixture call-count checks.

  Run in the foreground:

  ```bash
  NODE_OPTIONS=--max-old-space-size=2048 \
    pnpm test:e2e -- e2e/web/chat/mcp-tool.spec.ts
  ```

  Expected: FAIL at the pre-composer canonical URL assertion on current code.
  Do not rerun for luck. Leave this verified RED change in the worktree while
  implementing the production cutover.

- [ ] **Step 3: Write the pure session-state RED**

  Model only valid domain states:

  ```ts
  type DraftSessionState =
    | { kind: "fresh" }
    | { kind: "sending" }
    | { kind: "recovering"; ownerMounted: boolean }
    | { kind: "persisted"; resumeOnMount: boolean };
  ```

  Tests must pin:

  - clean/owner-visible/stale-marker history starts persisted;
  - missing fresh starts fresh;
  - missing sent starts recovering with no owner mounted;
  - send start: fresh -> sending;
  - live send failure: sending -> recovering with owner retained;
  - recovered history -> persisted and requests the same single resume probe
    for both initial and live recovery;
  - final 404 -> fresh;
  - indeterminate error has no transition;
  - finish -> persisted without remount/resume.

  Run the new draft-session suite. Expected: FAIL because the reducer does not
  exist.

- [ ] **Step 4: Implement the pure state machine**

  Export initial-state and transition functions plus derived selectors for URL
  phase, query enablement, owner visibility, and resume-on-mount. No React,
  network, timers, storage, or router imports belong in this module. Run its
  suite to GREEN before wiring the component.

- [ ] **Step 5: Write the dynamic page-boundary RED**

  Call the async `/chat/[id]` page with mocked server-history functions and
  query seeding. Pin these wiring contracts directly:

  - clean route -> strict history fetch;
  - valid draft route -> tolerant draft-history fetch with the parsed phase;
  - invalid draft value -> strict history fetch;
  - tolerant `null` -> no query seed and `initialChatExists={false}`;
  - owner-visible draft -> query seeded and
    `initialChatExists={true}`/`initialDraftPhase={phase}`.

  Run:

  ```bash
  pnpm --filter web exec vitest run 'app/(chat)/chat/[id]/page.test.ts'
  ```

  Expected: FAIL because the current page neither parses draft intent nor
  selects the tolerant contract.

- [ ] **Step 6: Implement the canonical page boundary**

  - `/` redirects with `draftChatPath(crypto.randomUUID(), "fresh")` before
    rendering UI.
  - `/chat/[id]` parses `searchParams.draft`, uses strict or tolerant server
    history, seeds only non-null history, and renders:

    ```tsx
    <ChatPage
      chatId={id}
      initialDraftPhase={phase}
      initialChatExists={initialMessages !== null}
    />
    ```

  - invalid draft values use the strict persisted contract.
  - query parameters never authorize access.

- [ ] **Step 7: Implement one `ChatSession` owner**

  Required wiring:

  - `ChatPage` requires an explicit route ID; delete client chat-ID minting;
  - the draft-session state machine controls query enablement and whether the
    owner waits for recovery history;
  - `recoverSentDraft` is used only in the recovering state;
  - query data dispatches chat-visible; exhausted 404 dispatches missing;
    401/5xx/network retain recovery;
  - immediately before first send, native History API marks `sent` and state
    becomes sending;
  - send/onError failure enters recovery; successful `onFinish` marks persisted;
  - stale marker plus initial history cleans the marker on mount;
  - after history proves the atomic chat+Run transaction visible, both initial
    and live recovery trigger the same ref-guarded one-shot `resumeStream()`;
    live recovery changes the existing owner's resume signal without exchanging
    it for another wrapper;
  - marker changes use
    `window.history.replaceState(null, "", draftChatPath(chatId, phase))` only;
    no `router.replace`, sleep, or `sessionStorage`.

  Wire `shouldAdoptServerHistory` with message lists. Use `messageRenderKey` for
  the outer fragment and `${renderKey}-part-${partIndex}` for parts. Durable
  `message.id` remains unchanged for API callbacks.

- [ ] **Step 8: Replace source inspection with behavior**

  Update the existing model/compaction container suites to pass explicit route
  props and cover fresh versus hydrated owner mounting. Delete
  `chat-page.hydration.test.ts`; do not replace it with source reads or regex.

- [ ] **Step 9: Verify focused GREEN**

  Run sequentially:

  ```bash
  pnpm --filter web exec vitest run \
    'app/(chat)/page.test.ts' \
    'app/(chat)/chat/[id]/page.test.ts' \
    lib/services/chat/draft-route.test.ts \
    lib/services/chat/draft-session.test.ts \
    lib/services/chat/server.test.ts \
    lib/services/chat/queries.test.ts \
    lib/services/chat/history.test.ts \
    'app/(chat)/components/chat-page.models.test.tsx' \
    'app/(chat)/components/chat-page.compaction.test.tsx'
  pnpm --filter web typecheck
  pnpm --filter web lint
  NODE_OPTIONS=--max-old-space-size=2048 \
    pnpm test:e2e -- e2e/web/chat/mcp-tool.spec.ts
  ```

  Expected: every unit/container suite passes; browser passes on its first
  attempt with no retry/flaky marker.

- [ ] **Step 10: Commit the cutover**

  Commit the named production/tests and E2E files:

  ```text
  fix(web): preserve chat state through first persistence
  ```

### Task 6: Delete redundant client identity after the cutover

**Files:**

- Modify: `apps/web/contexts/chat-context.tsx`
- Modify: `apps/web/app/(chat)/components/command-palette.tsx`
- Modify: `apps/web/app/(chat)/components/chat-list-sidebar/index.tsx`
- Modify: `apps/web/app/(chat)/components/app-sidebar/app-sidebar-actions.tsx`
- Modify: `apps/web/app/(chat)/components/chat-list-sidebar/chat-list.tsx`
- Modify: `apps/web/app/(chat)/projects/[id]/page.tsx`
- Modify: affected existing web tests/mocks that construct `ChatContextType`

- [ ] **Step 1: Establish the compiler RED**

  Delete `activeChatId`, `draftChatId`, `draftRestored`, setters,
  `recordSentDraft`, the storage effect/key, and `useStartNewChat` from the
  context. Run web typecheck and save the exact stale-consumer list.

- [ ] **Step 2: Move every stale consumer to route authority**

  - New-chat links remain plain `href="/"`.
  - Command palette keeps its existing close-then-`router.push("/")` flow.
  - `ChatList` derives selection only from `usePathname()`.
  - Project/delete flows navigate normally without clearing context identity.
  - Do not rename `ChatContext`; it still owns chat-wide model selection, and a
    repository-wide rename is unrelated churn.

- [ ] **Step 3: Verify GREEN and commit**

  Run web typecheck plus the existing chat-list, chat-item, and command-palette
  suites. Commit:

  ```text
  refactor(web): make routes the chat identity authority
  ```

## Chunk 3: Documentation, verification, and publication

### Task 7: Close the tracker/documentation loop

**Files:**

- Modify: `docs/testing.md`
- Modify: `docs/code-quality-tracker.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-08-16-message-render-identity.md`

- [ ] **Step 1: Update authoritative documentation**

  - remove the deleted source-regex follow-up from `docs/testing.md`;
  - narrow the tracker row to genuinely disabled Vitest-rule work;
  - record PR #405's retry as the architectural route/render-identity defect;
  - retain the no-go on retries, force clicks, blanket timeouts, sleeps, and
    source-regex acceptance;
  - add a dated changelog entry for canonical draft routes, URL-only identity,
    Run-ID render keys, and deterministic adoption coverage;
  - check tasks only after their commands actually pass.

- [ ] **Step 2: Run bounded local verification sequentially**

  ```bash
  pnpm --filter web test
  pnpm --filter web lint
  pnpm --filter web typecheck
  NODE_OPTIONS=--max-old-space-size=2048 pnpm --filter web build
  pnpm lint:root
  pnpm lint:ast-grep
  pnpm lint:markdown
  pnpm format:check
  git diff --check
  ```

  If the capped local build fails due environment/memory, report the exact
  failure and rely only on a later successful remote Build job.

- [ ] **Step 3: Independent code reviews**

  Dispatch one specification reviewer and one code-quality reviewer over the
  full branch diff. Independently verify every P0/P1, fix test-first, and rerun
  affected gates.

- [ ] **Step 4: Commit documentation**

  ```text
  docs(web): record architectural E2E flake repair
  ```

### Task 8: Publish the repair PR and rebuild the blocked stack safely

**Files:** Git/GitHub metadata only after the worktree is clean.

- [ ] **Step 1: Verify stack/base truth**

  Confirm this branch is based on current PR #404 live head using
  `gh stack view --json`, `git merge-base`, and `gh pr view 404`.

- [ ] **Step 2: Move issue-closing ownership**

  PR #402 currently says `Closes #403`, but #405 proved incomplete acceptance.
  Change #402 to `Related to #403`. The repair PR owns `Closes #403` only after
  all acceptance criteria pass.

- [ ] **Step 3: Push and create the non-draft stacked PR**

  Push normally and create the PR on
  `quality-taser/anti-slop-object-parameters`. Include root cause, route/session/
  Run-ID decisions, exact verification counts, stack dependency on #404, and
  `Closes #403`. Do not use a `Test plan` heading or mention Codex.

- [ ] **Step 4: Watch final-head CI**

  Use `gh run watch --exit-status`. A Playwright retry is failure even if the job
  recovers. Diagnose; never rerun for luck.

- [ ] **Step 5: Rebuild symbol ownership without rewriting remote history**

  Create a fresh branch from the repair tip and cherry-pick symbol commits
  `6ba7cfba` and `ab64ac48`. Open the replacement PR on the repair branch,
  update tracker references, then mark #405 superseded. Do not merge.

- [ ] **Step 6: Re-fetch live review state**

  Use `pr-review-fetcher` for unresolved threads. Verify, fix or evidence-reject,
  reply inline, resolve addressed threads, then finish with `gh pr checks` and
  `gh stack view --json`.

## Revision history

- **v3 (2026-08-16):** Added direct RED coverage for the dynamic chat page's
  strict/tolerant fetch, seeding, and prop wiring. Corrected live first-send
  recovery to trigger the same history-gated, ref-guarded resume probe as
  reload recovery without remounting its existing owner.
- **v2 (2026-08-16):** Reordered work so every commit stays independently
  typecheckable; moved browser RED before production cutover; added a real root
  page redirect test, fresh and sent auth callbacks, the query-layer recovery
  seam, and a pure draft-session state machine.
- **v1 (2026-08-16):** Initial implementation plan from the approved v5 design.
