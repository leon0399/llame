# Replace the chat UI with Vercel AI Elements

Date: 2026-07-23 · Status: proposed (awaiting approval)

## Goal

Replace `apps/web`'s hand-rolled chat **view** with Vercel AI Elements
(`@ai-elements` registry, vendored into `packages/ui/src/components/ai-elements/`),
fully — text via Streamdown `MessageResponse`, tool calls via AI Elements `Tool`.
The **data layer stays untouched**: AI Elements is presentational only.

## Spike outcome (feasibility, done)

Vendored `message.tsx` typechecks against our AI SDK **v6** — `import type
{ UIMessage, FileUIPart } from "ai"` resolves clean; the only errors are
`asChild` on base-nova `Button` (→ `render`), the same mechanical fix we applied
library-wide. No fundamental blocker. `streamdown@2.5.0` + `@tailwindcss/typography`
already added to `packages/ui/package.json` by the spike.

## Decisions (confirmed)

- **Text/markdown → Streamdown `MessageResponse`** (fully canonical). Accepts:
  re-baselining text/code, KaTeX-by-default, `globals.css` `@source` directive,
  and the security lockdown below.
- **Tool calls → AI Elements `Tool` wholesale.** `tool-call-part.test.tsx` gets
  rewritten to target the new component; part-state → `Tool` state enum mapping.

## Scope (forced defaults — not up for decision)

- **Keep the entire data layer**: `lib/services/chat/*`, `lib/services/models/queries.ts`,
  `lib/api/client.ts`, `contexts/{chat-context,active-runs-context}.tsx`, and the
  `useChat`/`DefaultChatTransport`/run-bridge wiring in `chat-page.tsx:226-347`.
- **Vendor location**: `packages/ui/src/components/ai-elements/` (scaffolded);
  consumers import `@workspace/ui/components/ai-elements/*`.
- **Fix the doubled `apps/web/components/components/ai/` path** in the same pass
  (it holds the hand-rolled files being replaced).

## Components to vendor (minimal set for our parts)

`conversation`, `message` (incl. `MessageResponse`), `prompt-input`, `reasoning`,
`tool`, `code-block` (+ transitive `shimmer`). **Not** vendored (no data for them,
YAGNI): attachments, sources, suggestion, task, inline-citation, context, model-selector
(we keep our richer `ModelSelector`).

Per-component adaptation: rewrite `@/components/ui/*`→`@workspace/ui/components/*`
and `@/lib/utils`→`@workspace/ui/lib/utils`; `asChild`→`render`; add JSDoc +
stories per `packages/ui` convention.

## Message-parts → AI Elements mapping (in `chat-page.tsx`)

| part.type                 | render                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `text`                    | `MessageResponse` (Streamdown, prefixes locked)                                         |
| `reasoning`               | `Reasoning` / `ReasoningTrigger` / `ReasoningContent` (`isStreaming` from `part.state`) |
| `tool-*` / `dynamic-tool` | `Tool` / `ToolHeader` / `ToolInput` / `ToolOutput` (state-enum mapped)                  |
| `data-cap-notice`         | **keep** a minimal cap-notice chip (no AI Elements equiv; preserves D6)                 |
| `data-model-context`      | `null` inline → rendered as `ModelSwitchBoundary` overlay (unchanged)                   |
| other                     | fallback "unsupported part"                                                             |

## llame overlays preserved (custom compositions layered on the shell)

`ModelSwitchBoundary`, `CompactionBoundary`, `MessageUsage`, `MessageForkButton`,
`ModelSelector`, `EffectiveContextInspector`, cap-notice chip. `Conversation`
replaces `chat-container.tsx` (both use `use-stick-to-bottom`). `PromptInput`
replaces the hand-rolled composer; our `ModelSelector` sits in `PromptInputTools`;
send/stop/status wired to existing `handleSubmit`/`handleStop`/`status`. No
attachments UI (none shipped).

## Security — Streamdown renders model output (multi-tenant)

`MessageResponse` defaults `allowedImagePrefixes`/`allowedLinkPrefixes` to `["*"]`.
Model output is semi-trusted and prompt-injectable, so:

- **Images**: lock to `[]` (no auto-loaded remote images) — auto-fetch is a
  tracking/SSRF surface. Revisit if an image feature is designed.
- **Links**: allow `["https://", "http://"]` only; ensure `rel="noopener noreferrer"`
  and `target="_blank"` on rendered anchors.
- Set once in the vendored `message.tsx` defaults (a documented fork), not per call site.

## Invariants that MUST stay green (regardless of the swap)

- ToolCall **live-vs-historical render parity** (D5) — reproduced by the new `Tool` renderer.
- **Cap-notice** (D6) — kept as a chip.
- **Compaction summary is plaintext, never markdown** (public-share security) — unchanged.
- **`data-model-context` never renders as inline content** — unchanged.
- Draft/persisted id independence, SSR→RQ hydration, durable-run cancel, resume-on-refresh.

## Tests

- **Rewrite**: `tool-call-part.test.tsx` (→ AI Elements `Tool`), reasoning coverage
  (→ AI Elements `Reasoning`).
- **Keep green**: `chat-page.compaction.test.tsx`, `chat-page.hydration.test.ts`,
  `chat-page.models.test.tsx`, `message-fork-button.test.tsx`, `message-usage.test.tsx`,
  `model-selector.test.tsx`, `model-switch-boundary.test.tsx`,
  `effective-context-inspector.test.tsx`, `compaction-boundary.test.tsx`,
  `command-palette.render.test.tsx`, sidebar tests.
- **New**: stories for the vendored AI Elements components (+ baselines — recaptured by hand).

## Visual baselines

Text/code/tool/reasoning rendering changes → their baselines re-churn. Recaptured
manually (Leo), per the established workflow.

## Phased implementation

1. **Vendor + adapt** the 7 AI Elements components (alias, `asChild`→`render`, JSDoc,
   prefix lockdown in `message.tsx`); add `globals.css` `@source "…/streamdown/dist/*.js"`.
2. **Stories** for each vendored component (per convention).
3. **Rewire `chat-page.tsx` view** (line 450+): `Conversation` + `Message` + parts
   switch (Response/Reasoning/Tool) + overlays.
4. **Swap composer** to `PromptInput`; keep `ModelSelector`, send/stop/status.
5. **Remove** hand-rolled `components/components/ai/{message,prompt-input,chat-container}.tsx`;
   fix the doubled path; update importers.
6. **Tests**: rewrite the two, keep the rest green; full `apps/web` unit + storybook suites.
7. **Verify** typecheck/lint/format/unit/stories; hand-off baselines for recapture.

## Branching

This depends on base-nova + the `@ai-elements` scaffold (PR #238, open). It should
be a **separate PR stacked on `feat/shadcn-base-nova`**, not piled onto #238.
