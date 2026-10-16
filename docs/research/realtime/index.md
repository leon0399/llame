# Realtime updates

Research on pushing record changes from the API to connected clients.

- [Server-to-client push for record changes](./2026-10-16-push-transport-and-asyncapi.md) - Separates the missing change signal from the transport choice, turns Postgres NOTIFY pointers into owner-scoped WebSocket messages carrying the HTTP API's own records, and makes a hand-authored AsyncAPI 3.1 document the protocol source from which server and client validators are generated.
