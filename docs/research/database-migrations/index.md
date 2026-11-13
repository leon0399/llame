# Database migrations

Research on migration-history design, query-layer alternatives and preserving llame's PostgreSQL tenant-security requirements.

## Studies

- [Database migration and query-layer alternatives for llame](./2026-11-13-database-layer-alternatives.md) - Compares Drizzle v1, Kysely, a migration-only runner and other ORMs against llame's migration history, RLS requirements and existing-database upgrade needs; proposes a disposable-database decision experiment.
