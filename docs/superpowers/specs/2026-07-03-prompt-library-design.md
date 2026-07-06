# Prompt library — saved prompts with `/` composer access

## Objective

A durable, reusable-prompt primitive: a user saves named prompt templates and
inserts one by typing `/<name>` in the composer. This is the roadmap's v0.5
"slash commands" seed in its genuinely-useful form (reusable prompts, not just
shortcuts to existing buttons), and it's validated by our closest comp — Open
WebUI has exactly this (`Prompt{command,title,content}` surfaced via a `/`
command menu). Reuses llame's proven owner-scoped-CRUD pattern (memories) for the
backend; the novel part is the composer autocomplete.

## Design

### Backend (mirror the memories CRUD pattern)

- `prompts` table: `id`, `user_id` (fk users, cascade), `name` (the slash trigger
  + label), `content` (the template body), `created_at`/`updated_at`. `UNIQUE
  (user_id, name)` so `/<name>` is unambiguous. RLS `prompts_owner` (`user_id =
  current_user`) + FORCE (hand-appended, like every other RLS table). DB CHECKs:
  `name` 1..64, `content` 1..8000.
- `PromptsController` at `/api/v1/me/prompts` (mirrors `MeMemoriesController`):
  - `GET` → `PromptResponse[]` (owner's, name-ordered).
  - `POST { name, content }` → 201; 409 on the unique-name conflict; a per-user
    cap (e.g. 100).
  - `PATCH :id { name?, content? }` → 200 / 404; 409 on rename collision.
  - `DELETE :id` → 204 / 404.
- DTOs + explicit response types (code-first OpenAPI). Owner-scoped via
  `runAs`; RLS is the guard, `user_id` the seatbelt.

### Web — settings management

- `prompts-section.tsx` in settings (mirrors `memories-section.tsx`): list, add
  (name + content), edit, delete. A prompts service (list query + CRUD
  mutations, invalidate on mutate).

### Web — composer `/` autocomplete (the novel part)

- Pure trigger logic (`matchingPrompts(input, prompts)`, unit-tested): returns
  the filtered list when `input` is a lone slash-token with AT LEAST ONE char
  (`^/(\S+)$`) AND there are case-insensitive name-PREFIX matches; otherwise
  `null` (no menu). The `\S+` (not `\S*`) is load-bearing: **bare `/` never opens
  the menu**, so a literal `/` message still sends (an empty token would prefix-
  match every prompt and hijack Enter). A message merely containing a slash
  ("what is /etc/hosts", has spaces) and a multiline paste never trigger; `/xyz`
  with no match hides the menu (doesn't block literal text).
- The prompts list comes from `usePromptsQuery()` (the SHARED `["me","prompts"]`
  key, read by both settings and the composer hook) — fetched once, filtered per
  keystroke by the pure function; a settings edit invalidates it.
- A popover above the composer lists matches (`/name` + content preview) with a
  highlighted index. Selecting (click or BARE Enter) replaces the input with the
  prompt's `content`; Escape dismisses (any edit reopens); ArrowUp/Down move.
  Shift+Enter is NOT intercepted (falls through to a newline).
- Composer hook: `PromptInputTextarea` currently spreads `{...props}` after its
  own `onKeyDown`, so a passed `onKeyDown` silently replaces the Enter-submit.
  Change it to destructure `onKeyDown` and call it FIRST, bailing if it
  `preventDefault`ed — a minimal, backward-compatible merge (no `onKeyDown`
  passed → identical behavior). The autocomplete passes an `onKeyDown` that
  handles Arrow/Enter/Escape only while the menu is open (preventDefault to stop
  submit), else no-ops.

## Testability

- RLS integration: owner CRUD round-trips; a cross-tenant read/update/delete is
  denied (RLS); the `UNIQUE(user_id, name)` rejects a duplicate (per user) but
  ALLOWS the same name across users; content/name CHECK bounds.
- API: 409 on duplicate name (create + rename); 404 cross-tenant; cap.
- Web: the prompts service (URLs/verbs); `matchingPrompts` pure logic (triggers
  on a lone slash-token, filters by prefix, null on space/no-match); the
  `PromptInputTextarea` onKeyDown merge (passed handler runs; preventDefault
  suppresses submit; absent → submit still works).

## Non-goals (named)

- Sharing prompts across users / org-scoped prompt libraries. Prompt
  versioning/history. Built-in action commands (`/new`, `/share`) — a
  separate, later dispatch surface. Import/export.

  (Template variables / `{{input}}` placeholders were listed here as a named
  follow-up in the original v1 design; they shipped in the same PR — see
  `2026-07-03-prompt-templating-design.md`.)

## Revision history

- **v2 (2026-07-03):** Round-1 review. Both reviewers confirmed the backend
  mirrors memories correctly (FORCE hand-appended, the `23505`→409 name-conflict
  handling — note the DB `UNIQUE` + catch is STRICTER than memories'
  pre-check-only, avoiding a race-500). Fixes: the trigger is `^/(\S+)$`
  (bare-`/` excluded — the adversarial literal-send trap) with a case-insensitive
  prefix; only BARE Enter selects (Shift+Enter → newline); the composer prompts
  list is `usePromptsQuery()` on the shared key (fetched once, not per keystroke).
  Corrections: `name` is a hard slug CHECK (`^[A-Za-z0-9_-]{1,64}$`), not just a
  length bound; the Open WebUI comp is `Prompt{command, name, content}` (two
  columns) — llame deliberately MERGES trigger+label into one `name`.
- **v1 (2026-07-03):** Initial.
