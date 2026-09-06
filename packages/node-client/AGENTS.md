# Reusable Node clients

- Follow root AGENTS.md and docs/node/shared-access.md.
- Preserve authority/account credential binding and no-redirect behavior.
- Capability failure cannot switch provider, Node, transport, or operation.
- Query observations must match discovery's principal/source and request method.
- Lost admission responses are uncertain: never replay a mutation automatically.
- Keep terminal rendering, local database, and model/tool execution out of clients.
- Test real HTTP correlation and transport failure, not only injected return values.
