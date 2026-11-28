---
status: accepted
---

# A Claude subscription reaches llame through a login llame holds

An owner who wants their Claude subscription in llame signs in through the
Claude Code OAuth flow, and llame stores and refreshes the resulting Credential
like any other. llame calls Anthropic's API itself with that Credential, so the
Run keeps llame's own tool loop, history, and failure classes.

We chose this knowing it conflicts with Anthropic's stated terms. The
[legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use),
read on 2026-11-20, says developers "may not collect, store, or intermediate
Claude.ai credentials or session tokens", and enforcement may come without
notice. Leo chose this path because reference harnesses, oh-my-pi first among
them, ship the same login, and he accepted the enforcement risk for his own
subscription.

## Considered options

- Run the unmodified Claude Code binary as a model wire, as pi-claude-code and
  OpenCode's Claude Agent do. Claude Code only talks to the model, the harness
  keeps its tools and history, and llame never sees a token. Anthropic's terms
  allow an end user to sign in to unmodified Claude Code on a hosting platform.
  llame would depend on a CLI on every executor, and on Claude Code's own
  request shape.
- Leave Claude subscriptions out and offer only the shipped API-key adapter.
  The subscription tracker's Claude gate would stay unowned.

## Consequences

- The endpoint accepts the Credential only with Claude Code's request identity,
  and that identity has no contract. Whether llame sends it, and how drift is
  detected, is decided in
  [Claude request identity](https://github.com/leon0399/llame/issues/1855).
- Third-party use of the Credential bills as extra usage per token, not against
  the plan's included limits
  ([research](../research/credentials/2026-11-20-claude-subscription-oauth.md)).
- The Credential serves only the person who signed in. Sharing one Claude login
  across owners adds Anthropic's routing prohibition
  ([research](../research/credentials/2026-11-20-subscription-sharing.md)).

This was decided while charting
[the way to llame-managed credentials](https://github.com/leon0399/llame/issues/1845#issuecomment-7052477684),
for
[use Claude subscription through a provider-owned execution path](https://github.com/leon0399/llame/issues/754).
