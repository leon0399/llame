# Realtime updates

Research on pushing record changes from the API to connected clients.

- [Server-to-client push for record changes](./2026-10-16-push-transport-and-asyncapi.md) - Separates the missing change signal from the transport choice, recommends Postgres NOTIFY pointers fanned out over one owner-scoped stream of invalidation DTOs, and uses AsyncAPI 3.0 as generated documentation over the same @nestjs/swagger DTOs that orval already turns into client types.
