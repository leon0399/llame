# Realtime updates

Research on pushing record changes from the API to connected clients.

- [Server-to-client push for record changes](./2026-10-16-push-transport-and-asyncapi.md) - Separates the missing change signal from the transport choice, fans Postgres NOTIFY pointers out over one owner-scoped WebSocket of invalidation messages, and makes a hand-authored AsyncAPI 3.0 document the protocol source from which server and client validators are generated.
