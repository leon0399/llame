# apps/api

NestJS 11 + Drizzle + pg-boss, and the SOLE database owner.

Check: every endpoint has a class-validator DTO and an explicit response type mirroring
an egress allowlist; `apps/api/openapi.json` is regenerated in the same change as any
endpoint, DTO, or Swagger annotation edit (CI fails on a stale copy); one NestJS module
per feature with `@Inject(...)` decorators each on their own line; queue primitives are
consumed by runs, search workers, and session cleanup; `RunExecutionService` stays
transport-agnostic and no run executes on the HTTP thread; `messages.parts` ordering and
prior model-bearing parts are preserved rather than rebuilt during replay; chained type
assertions (`as unknown as T`) are banned — narrow the dependency with a `Pick<>` instead.
