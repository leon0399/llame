---
type: Reference
title: "Seal"
description: "Durable approval suspension and nested continuation streams"
resource: "https://github.com/vercel-labs/seal"
sources:
  - id: backend-agent-driver-py
    resource: "https://github.com/vercel-labs/seal/blob/7724faa0c71c744a44751dcf15d666a296e8badb/backend/agent/driver.py"
    title: "session workflow"
  - id: backend-agent-turn-py-l210-l257
    resource: "https://github.com/vercel-labs/seal/blob/7724faa0c71c744a44751dcf15d666a296e8badb/backend/agent/turn.py#L210-L257"
    title: "subagent tool"
  - id: backend-app-chat-py-l101-l117
    resource: "https://github.com/vercel-labs/seal/blob/7724faa0c71c744a44751dcf15d666a296e8badb/backend/app/chat.py#L101-L117"
    title: "Approval submission"
  - id: backend-app-chat-py
    resource: "https://github.com/vercel-labs/seal/blob/7724faa0c71c744a44751dcf15d666a296e8badb/backend/app/chat.py"
    title: "stream adapter"
  - id: backend-tests-test-contract-py-l194-l230
    resource: "https://github.com/vercel-labs/seal/blob/7724faa0c71c744a44751dcf15d666a296e8badb/backend/tests/test_contract.py#L194-L230"
    title: "parallel approvals"
---

# Seal

- **Stack:** Python, FastAPI, Vercel Workflows/AI SDK, Vite
- **Observed:** 2026-09-10 @ `7724faa0c71c744a44751dcf15d666a296e8badb`

High-confidence mechanism reference; moderate confidence in longer-term reuse
from this example app. Relevant to future approvals and child Runs, with useful
reconnect test cases for the current stream contract.

**Study**

1. **F10: Durable parent/child completion.** A session workflow[^backend-agent-driver-py]
   starts turn workflows and waits on typed hooks. The subagent tool[^backend-agent-turn-py-l210-l257]
   starts a child turn, records its identity, and awaits durable completion.
   Study the lifecycle mapping while retaining llame-owned Chat/Run identities.
2. **F11: Cursor before resume.** Approval submission[^backend-app-chat-py-l101-l117]
   calculates the continuation cursor before resuming a batch of decisions,
   so resumed output cannot advance past the cursor before it is captured.
   A concrete ordering invariant for a future persisted approval pause.
3. **F12: Reconnect and nested output.** The stream adapter[^backend-app-chat-py]
   tails child progress into preliminary nested output; completed child messages
   support reconstruction on reload. Contract tests cover parallel approvals[^backend-tests-test-contract-py-l194-l230]
   and reload behavior. These are useful test scenarios, not evidence that
   llame needs Vercel's workflow storage.

**Caution:** This demo has no authenticated approval identity or owner-scoped
access model, and child turns explicitly set `gated=False` to run bash without
approval. A child lacking approval UI must not gain authority in llame. Keep
llame's RLS, immutable context receipts, native mutation fencing, and existing
PostgreSQL/pg-boss execution path.

[^backend-agent-driver-py]: [session workflow](https://github.com/vercel-labs/seal/blob/7724faa0c71c744a44751dcf15d666a296e8badb/backend/agent/driver.py)

[^backend-agent-turn-py-l210-l257]: [subagent tool](https://github.com/vercel-labs/seal/blob/7724faa0c71c744a44751dcf15d666a296e8badb/backend/agent/turn.py#L210-L257)

[^backend-app-chat-py-l101-l117]: [Approval submission](https://github.com/vercel-labs/seal/blob/7724faa0c71c744a44751dcf15d666a296e8badb/backend/app/chat.py#L101-L117)

[^backend-app-chat-py]: [stream adapter](https://github.com/vercel-labs/seal/blob/7724faa0c71c744a44751dcf15d666a296e8badb/backend/app/chat.py)

[^backend-tests-test-contract-py-l194-l230]: [parallel approvals](https://github.com/vercel-labs/seal/blob/7724faa0c71c744a44751dcf15d666a296e8badb/backend/tests/test_contract.py#L194-L230)
