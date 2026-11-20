# Credentials

Research on how llame owns, stores, and refreshes credentials for providers, MCP servers, and outside services: login flows, refresh, the client identity each protocol demands, and what each provider's terms permit.

- [Codex login path](./2026-11-20-codex-login-path.md) - Direct OAuth with the Codex public client id against the App Server alternatives, with token lifetimes, rotation errors, device code, and the policy boundary.
- [MCP OAuth from a self-hosted llame installation](./2026-11-20-mcp-oauth-self-hosted.md) - Reads MCP authorization 2026-07-28 against the two client libraries llame pins, then sizes the client identity, redirect URI and Machine relay work that OAuth for remote MCP servers needs.
- [Subscription credentials across several Owners](./2026-11-20-subscription-sharing.md) - Reads OpenAI and Anthropic terms, help articles and Codex auth documentation to answer whether one subscription login may serve Runs for several Owners, and states the subscriber-binding rule llame must enforce.
