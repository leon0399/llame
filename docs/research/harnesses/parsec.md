---
type: Reference
title: "parsec"
description: "In-loop re-read and command-loop gates, byte-stable cache-safe history splicing, and measured rather than modeled token savings"
resource: "https://github.com/daseinlabs/parsec"
observed:
  date: "2026-09-17"
  revision: "defcc7f4034a1bba42bec5bf8d14a4ad34f716ec"
sources:
  - id: direction-md-l23-l37
    resource: "https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/DIRECTION.md#L23-L37"
    title: "data plane local, control plane remote"
  - id: packages-proxy-src-noreread-rs-l1-l54
    resource: "https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/noreread.rs#L1-L54"
    title: "no-reread policy and constants"
  - id: packages-proxy-src-noreread-rs-l695-l724
    resource: "https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/noreread.rs#L695-L724"
    title: "gate_bash loop breaker with insist valve"
  - id: packages-proxy-src-hook-rs-l1-l8
    resource: "https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/hook.rs#L1-L8"
    title: "hooks never fail the session"
  - id: packages-proxy-src-hook-rs-l70-l79
    resource: "https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/hook.rs#L70-L79"
    title: "PreToolUse deny output"
  - id: packages-proxy-src-splice-rs-l1-l14
    resource: "https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/splice.rs#L1-L14"
    title: "positional fold-back contract"
  - id: packages-proxy-tests-golden-conversation-rs-l259-l270
    resource: "https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/tests/golden_conversation.rs#L259-L270"
    title: "byte stability assertion"
  - id: packages-proxy-tests-golden-conversation-rs-l299-l301
    resource: "https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/tests/golden_conversation.rs#L299-L301"
    title: "simulated cache ratio floor"
  - id: packages-proxy-src-counterfact-rs-l1-l30
    resource: "https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/counterfact.rs#L1-L30"
    title: "local BPE counterfactual"
  - id: packages-proxy-src-governor-rs-l100-l112
    resource: "https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/governor.rs#L100-L112"
    title: "governor defaults, mode Off"
  - id: packages-proxy-src-governor-rs-l756-l775
    resource: "https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/governor.rs#L756-L775"
    title: "kill, deliver, and horizon directives"
  - id: packages-proxy-src-server-rs-l684-l698
    resource: "https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/server.rs#L684-L698"
    title: "PARSEC_RECORD_DIR verbatim body capture"
  - id: packages-proxy-src-setup-desktop-rs-l1-l28
    resource: "https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/setup_desktop.rs#L1-L28"
    title: "Claude Desktop TLS interception posture"
---

# parsec

- **Stack:** Rust workspace (`packages/engine`, `packages/proxy`, `packages/mapgen`), a JS OpenCode plugin, and a Python scoring service (`packages/brain`); public history begins 2026-09-14 (10 commits) although `DIRECTION.md` records decisions from July, so the tree is a republish; MIT (Dasein Labs)

A local proxy and hook set that sits between Claude Code, OpenCode, Codex CLI,
or Claude Desktop and the provider to cut tokens per turn. Its stated rule is
"data plane local, control plane remote": model traffic leaves from the user's
machine with the user's credentials, while scoring, the savings ledger, and
rule updates are a hosted service that receives capped chunk text when scoring
is enabled[^direction-md-l23-l37]. llame owns its loop and never needs a
proxy; the value here is three portable in-loop mechanisms and one testable
invariant.

**Study**

1. **Re-read and command-loop gate before the tool runs.** Reads are
   tracked as (file, line ranges); a re-read of content already in context is
   denied with a pointer to where it already is; an edit evicts the file's
   records and resets loop counts; a denial grants a one-shot pass so
   recovery is never blocked; denials under about 150 tokens are suppressed
   because "a denial that saves less than its own message costs is a net
   loss"[^packages-proxy-src-noreread-rs-l1-l54]. A Bash command repeated
   `LOOP_N = 3` times with no intervening edit is denied on alternating
   attempts with an explicit "take a DIFFERENT action"
   message[^packages-proxy-src-noreread-rs-l695-l724]. The deny travels as a
   PreToolUse `permissionDecision`, so the agent's own transcript keeps the
   attempted call and the reason; nothing is substituted after the
   fact[^packages-proxy-src-hook-rs-l70-l79]. High confidence for #91: this
   is a pure function over recorded state that fits llame's worker as a
   pre-dispatch check on native `read` and `bash`.
2. **Cache-safe history rewriting as a byte-stability law.** Curated text is
   folded back onto the original content blocks in place by position;
   message count and order are preserved and `tool_use`, `tool_result`, and
   image blocks are never dropped or
   reordered[^packages-proxy-src-splice-rs-l1-l14]. The golden test asserts
   that for every turn, every message the previous call served is
   byte-identical ("anchors move; bytes
   don't")[^packages-proxy-tests-golden-conversation-rs-l259-l270] and that
   the simulated frozen-to-new ratio stays at or above
   10:1[^packages-proxy-tests-golden-conversation-rs-l299-l301]. High
   confidence for #153 and #764: any llame history transform that wants
   provider cache reuse should carry the same replayable assertion, keyed by
   content fingerprint rather than turn index.
3. **Measured savings, floor not estimate.** Where the provider exposes
   `count_tokens`, the original body is counted per request; where it does
   not, `delta = bpe(original) - bpe(served)` with the provider's own
   encoding, stamped `counterfactual_source: "local_bpe"` so it never pools
   silently with probed rows, and framed as "undervalued, never
   overvalued"[^packages-proxy-src-counterfact-rs-l1-l30]. High confidence
   for #91 and any receipt-side token reporting: consume budgets against the
   provider's counters and label the measurement source.
4. **Budget and stall directives injected as ordinary turns.** The governor
   ports a Jaccard loop detector and token-ratio backstops, then appends one
   user-role message from a fixed set (`KILL`, `DELIVER`, `HORIZON`), deduped
   per fire step[^packages-proxy-src-governor-rs-l756-l775]. It ships
   `GovMode::Off` by default and its thresholds are marked
   uncalibrated[^packages-proxy-src-governor-rs-l100-l112]. Moderate
   confidence for #91, #765, and #769 as intervention wording and placement;
   low confidence in the numbers.

**Caution**

- **Fail-open is the universal policy.** Hooks "must NEVER fail the
  session: any internal error exits 0 silently", counted in the session file
  so a dead hook is
  distinguishable[^packages-proxy-src-hook-rs-l1-l8]. Correct for an
  optimization, wrong as a template for #763 or #778. Adopt the counting,
  invert the default.
- **Transparent rewriting severs client transcript from served prompt.**
  Served text and appended governor turns are invisible to the client's own
  history. This is the failure llame's immutable receipts exist to prevent:
  curation must apply to, and be receipted from, the object llame persists
  as the Run.
- **The binary carries a verbatim wiretap.** `PARSEC_RECORD_DIR` dumps every
  real request body, pre-curation, to disk; off by default and
  fail-open[^packages-proxy-src-server-rs-l684-l698]. Any comparable debug
  capture in llame must be tenant-scoped and separate from the receipt
  store.
- **Claude Desktop support is TLS interception.** It requires mitmproxy on
  PATH and its CA in the system trust store, and it places the proxy in the
  path of subscription OAuth tokens; the module calls this "a real
  escalation"[^packages-proxy-src-setup-desktop-rs-l1-l28]. Not a pattern
  for any llame surface.
- **The data-plane rule drifted.** The rule "previously read 'the proxy
  sends vectors, never raw text'"; embedding moved server-side and chunk
  text now crosses the wire when scoring is
  on[^direction-md-l23-l37]. Auth headers are relayed verbatim under a
  single per-machine credential file; no tenant boundary exists anywhere.
- The "2x the context, half the cost" headline is not computed anywhere;
  the only measured quantity is tokens removed per request.

[^direction-md-l23-l37]: [data plane local, control plane remote](https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/DIRECTION.md#L23-L37)

[^packages-proxy-src-noreread-rs-l1-l54]: [no-reread policy and constants](https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/noreread.rs#L1-L54)

[^packages-proxy-src-noreread-rs-l695-l724]: [`gate_bash` loop breaker with insist valve](https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/noreread.rs#L695-L724)

[^packages-proxy-src-hook-rs-l1-l8]: [hooks never fail the session](https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/hook.rs#L1-L8)

[^packages-proxy-src-hook-rs-l70-l79]: [PreToolUse deny output](https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/hook.rs#L70-L79)

[^packages-proxy-src-splice-rs-l1-l14]: [positional fold-back contract](https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/splice.rs#L1-L14)

[^packages-proxy-tests-golden-conversation-rs-l259-l270]: [byte stability assertion](https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/tests/golden_conversation.rs#L259-L270)

[^packages-proxy-tests-golden-conversation-rs-l299-l301]: [simulated cache ratio floor](https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/tests/golden_conversation.rs#L299-L301)

[^packages-proxy-src-counterfact-rs-l1-l30]: [local BPE counterfactual](https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/counterfact.rs#L1-L30)

[^packages-proxy-src-governor-rs-l100-l112]: [governor defaults, mode Off](https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/governor.rs#L100-L112)

[^packages-proxy-src-governor-rs-l756-l775]: [kill, deliver, and horizon directives](https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/governor.rs#L756-L775)

[^packages-proxy-src-server-rs-l684-l698]: [`PARSEC_RECORD_DIR` verbatim body capture](https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/server.rs#L684-L698)

[^packages-proxy-src-setup-desktop-rs-l1-l28]: [Claude Desktop TLS interception posture](https://github.com/daseinlabs/parsec/blob/defcc7f4034a1bba42bec5bf8d14a4ad34f716ec/packages/proxy/src/setup_desktop.rs#L1-L28)
