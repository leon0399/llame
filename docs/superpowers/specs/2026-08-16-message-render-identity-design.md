# Message Render Identity Design

Version: v5

## Problem

PR #405 run `31915773223`, Product E2E job `95087648453`, reproduced a
first-attempt failure in the MCP durable-history acceptance test. The link-safety
modal opened, but its Close button detached until Playwright's 10-second action
timeout; the retry passed and `failOnFlakyTests` correctly failed the job.

The failure is not a slow-click problem. The first turn starts on `/`, where one
page module owns the live chat, and completion calls `router.replace("/chat/:id")`,
where a different page module owns the durable chat. That page-boundary swap
remounts the message subtree and destroys uncontrolled message-local state such
as link-safety modals, reasoning disclosure, and tool disclosure.

The same boundary hides a second identity problem. The live assistant's message
ID is the Run ID surrogate, while history returns the durable message ID. A
successful history has the same message count as the live log, so the current
count-only adoption guard refuses it; API-facing actions can retain the
run-surrogate ID until a remount or reload happens to replace the session.

## Decision

Make the chat route canonical before the stateful chat UI mounts. The `/` server
page waits for Next's actual-request `connection()` boundary, then generates a
cryptographically random UUID per navigation and redirects to
`/chat/:id?draft=fresh`. Both a new draft and an existing chat then render through
the existing `/chat/[id]` page leaf. There is no stateful `ChatPage` on `/`, and
the first successful turn never changes a dynamic route segment.
Persistent New Chat links disable speculative prefetch so UUID creation belongs
to activation, not viewport or hover behavior.

The draft marker is initial routing intent, not authorization and not a live
server-mode authority:

- `draft=fresh` means no send has been attempted for this route;
- immediately before the first send, native `history.replaceState` changes the
  marker to `draft=sent`, without replacing the Next route tree;
- after confirmed persistence, native `history.replaceState` removes the marker;
- the client session owner carries the corresponding mounted state. It does not
  ask a server rerender to switch draft mode after persistence.

The `/chat/[id]` server page probes owner-scoped history when a draft marker is
present. An owner-visible chat is hydrated normally and treated as persisted,
which self-heals a stale draft URL. A genuine owner-scoped 404 seeds a fresh
draft.

A `draft=sent` 404 is a recovery state, not proof that the send failed. The
client enables the existing TanStack history query with a bounded, query-native
retry budget. `ChatSessionContent` does not mount as resumable until history
succeeds. The accepted-turn transaction creates the chat, user message, and Run
atomically, so once history becomes owner-visible, the existing single resume
probe is sufficient: it can connect to that Run or observe its terminal state.
If the retry budget ends on an owner-scoped 404, no accepted transaction became
visible in the recovery window; the client changes the marker back to
`draft=fresh` and restores the ordinary composer. Network, 401, and 5xx failures
do not prove absence and must not downgrade the marker.

The uninterrupted first-send error path uses the same server reconciliation.
It enables the history query after the stream/request error. Success adopts the
server-backed chat; an exhausted owner-scoped 404 restores `draft=fresh`; an
indeterminate error retains `draft=sent` for reconnect/refetch recovery. This
handles pre-persistence validation failures without mistaking a disconnected
but accepted durable Run for a failed draft.

Remove the `sessionStorage` draft ID and restore path; the URL is the single
draft identity source. Remove the client `activeChatId` fallback as well: every
conversation is already identified by `/chat/:id`, and the pathname remains the
sidebar selection authority. Missing, unauthorized, and cross-tenant IDs remain
indistinguishable at the API boundary. A caller can already submit an arbitrary
chat ID directly, so the server-generated UUID is collision avoidance and route
canonicalization, not a trust boundary or reservation protocol.

A manually constructed `/chat/<foreign-id>?draft=...` is not a supported deep
link. It may render a fresh composer because the owner-scoped read is a 404, but
the write path remains tenant-isolated and returns the same 404 rather than
hijacking the foreign row. Recovery leaves the failed text visible and the New
Chat action obtains a new server-generated ID; it never converts the supplied
ID into trusted identity.

Preserve the complete callback URL, including the draft marker, when a stale or
revoked session redirects through login. Losing the marker would turn a recoverable
draft into a strict persisted-history request.

Collapse `DraftChatSession` and `PersistedChatSession` into one session owner.
The messages query is disabled for a pristine missing draft, enabled for a sent
or owner-visible chat, and becomes enabled after successful first persistence.
The already-mounted `ChatSessionContent` is not exchanged merely because the
chat becomes durable. Persisted routes keep server history fetching and standard
TanStack query hydration inside the same page boundary; no layout host,
cross-sibling hydration, duplicate browser cache bridge, or draft reservation
endpoint is added.

## Durable representation adoption

At settled `ready` status, an equal-length server history is adopted only when
its final position proves the same assistant run:

- the final live and server messages are both assistants at the same array
  position;
- the live assistant `message.id` is the Run ID surrogate;
- the durable assistant's `metadata.usage.runId` is the same Run ID.

A non-matching equal-length history is not adopted. Strictly longer settled
history and the existing equal-or-longer `error` recovery remain accepted;
shorter history and every in-flight state remain rejected. After adoption, the
live list holds durable message IDs for fork and other API-facing actions, and
the predicate becomes false, so the transition is idempotent.

Give each rendered message a domain identity that survives only the proven
live-to-durable representation transition:

- user and legacy assistant messages use their durable/client message ID;
- a live assistant uses its run-surrogate message ID, which is the Run ID;
- the corresponding durable assistant uses `metadata.usage.runId`;
- each part key is the stable message key plus its part position.

The durable `message.id` remains data, not the React key. The Run ID is the
ownership relation joining the two representations. Array index is not message
identity: bounded history can drop old entries and shift every surviving index.

## Rejected alternatives

- Do not rerun the failed job or increase action/navigation timeouts. That would
  accept the state-loss defect.
- Do not add `force: true`, retry the click, or treat spontaneous modal closure
  as success. A user loses the same interaction state.
- Do not add a test-only sleep after `status=ready`. There is no fixed duration
  for history adoption.
- Do not hoist only the link-safety modal. That repairs one symptom while other
  message-local state remains vulnerable.
- Do not key messages by array index, even with role mixed in.
- Do not keep `/` and `/chat/:id` as two stateful pages and merely move the URL
  assertion. The product remount remains.
- Do not cross from `/` to `/chat/:id` with native history. Next would retain
  the old router tree while the URL claimed the persisted page contract.
- Do not merge both URLs into one optional catch-all page. Next keys dynamic
  segments by parameter value, so the draft-to-ID change still recreates the
  tree.
- Do not put a persistent chat host in the layout. Its proposed hydration path
  depended on a `HydrationBoundary` mutating a shared cache before a later
  sibling rendered, which TanStack does not contract.
- Do not pre-create empty chats or add a draft reservation service. That adds
  storage lifecycle and cleanup solely to solve a client route-identity defect.
- Do not keep both the canonical draft URL and the old `sessionStorage` draft
  ID. Two identity authorities can resurrect the wrong chat.
- Do not call `router.replace` to remove the search marker. The native History
  API is appropriate only here, where the dynamic route and page contract do
  not change and the client already owns the mounted transition.

## Deterministic acceptance

The existing Playwright MCP test owns the composition regression using standard
Playwright routing:

1. navigating to `/` must reach `/chat/:id?draft=fresh` before the composer is
   usable;
2. the test records that route ID and holds the first post-finish browser
   history response for that exact chat after the API has produced it;
3. while the durable response is held, it opens the link-safety modal on the
   settled live message;
4. it releases the response, waits for the response and committed browser
   render frames, and requires the same modal to remain visible and closable;
5. the URL must be the clean `/chat/:id`, and a real reload must reconstruct
   the turn without executing the MCP tool again.

Holding the real response controls the live-to-durable adoption boundary. It
does not add an application test hook, custom harness, sleep, timeout increase,
or retry. `failOnFlakyTests` remains enabled.

Pure Vitest coverage pins the draft-route states, strict versus draft history
404 behavior, login callback preservation, the sent-draft retry outcomes
(history appears, final 404 returns to fresh, indeterminate error stays sent),
the exact equal-length Run-ID predicate (including a non-match), and message
render keys. Delete the source-regex `chat-page.hydration.test.ts`; its contracts
move to behavior in standard Vitest and Playwright suites rather than
source-text matching.

Run the focused browser test in the foreground with one Playwright worker and a
2 GiB Node heap cap. Repository lint, web typecheck, build, relevant unit tests,
and the full remote matrix remain required.

## Rollback

Reverting the canonical draft route, unified session ownership, render-key
change, and deterministic regression restores the previous behavior. There is
no schema, API authorization, persisted-data, or deployment-sequencing change.

## Revision history

- **v5 (2026-08-16):** Specified sent-draft reconciliation: bounded TanStack
  history retries gate the single resume probe, final owner-scoped 404 restores
  fresh state, and indeterminate failures retain recovery intent. Defined
  pre-persistence error and unsupported manual/foreign draft-URL behavior, and
  removed the redundant active-chat identity fallback.
- **v4 (2026-08-16):** Rejected the persistent layout host after verifying its
  cross-sibling hydration dependency was not a TanStack contract. Canonicalized
  the UUID route before `ChatPage` mounts, made the URL the sole draft identity,
  specified exact Run-ID adoption, and moved browser acceptance to the held
  durable-history boundary.
- **v3 (2026-08-16):** Rejected the unified optional catch-all after verifying
  that Next includes dynamic parameter values in React state keys; moved chat
  ownership above the changing page leaf and retained SSR through TanStack's
  current render-phase hydration behavior.
- **v2 (2026-08-16):** Corrected the cause from successful history adoption to
  the draft-to-persisted page transition; rejected shallow native history after
  inspecting Next's restore implementation.
- **v1 (2026-08-16):** Initial Run-identity design based on the PR #405 failure
  artifact.
