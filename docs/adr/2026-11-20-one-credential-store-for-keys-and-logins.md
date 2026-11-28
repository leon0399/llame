---
status: accepted
---

# One Credential store holds API keys and logins at both scopes

llame keeps every secret it holds for an external service as a Credential in
one store: a static API key, a subscription login with refresh state, and an
MCP server's OAuth grant. A Credential belongs either to the installation or to
one owner. A static key is a Credential that never refreshes.

We chose one store because the alternative is two encrypted-secret paths. The
installation store for the Codex login and the owner vault for API keys were
planned as separate issues, and each would have grown its own encryption, key
rotation, redaction, and fail-closed lookup. Owner-scoped subscription logins
need all of that from both sides.

The store ships in this order: the installation scope with the Codex login,
then OAuth for operator-configured MCP servers, then the owner scope. MCP OAuth
needs only the installation scope, so a second consumer with a different flow
tests the store before row-level security and encryption are designed around it.

## Considered options

- An owner vault for API keys only, with subscription logins kept at
  installation scope. Owners could not use their own subscriptions, which the
  providers' terms require once an installation has more than one person.
- Owner scope before MCP OAuth. Owner scope is the largest step, and building it
  second would shape the store around one consumer.

## Consequences

- The provider accounts and encrypted credential vault issue is rewritten
  around this store instead of introducing its own table.
- A Credential kind must also fit a non-model service, such as a GitHub token,
  although delivering GitHub access is outside this effort.
- Provider entries hold a Credential reference, not the secret, when they use
  the store. An operator's static key may instead stay in configuration through
  `{env:...}` or `{path:...}`. Logins, MCP grants, and owner keys always live
  in the store.
- The store is one Postgres table from the first cut, not a directory of files.
  A single-use refresh token must be spent once across API and worker processes
  that may run on different hosts, and Postgres is the one shared, locking store
  they all reach. Installation Credentials have no owner and are readable only
  under a system marker, never under an owner's identity. Secret fields sit in
  one encrypted payload beside plain metadata, so a new kind needs no migration.

This was decided while charting
[the way to llame-managed credentials](https://github.com/leon0399/llame/issues/1845#issuecomment-7052477684)
and in
[Where credentials are stored](https://github.com/leon0399/llame/issues/1846#issuecomment-7233226214),
for
[llame-managed credentials: login, storage, and refresh](https://github.com/leon0399/llame/issues/1825)
and
[provider accounts and encrypted credential vault](https://github.com/leon0399/llame/issues/18).
