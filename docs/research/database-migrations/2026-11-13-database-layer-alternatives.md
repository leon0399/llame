---
type: Research
title: "Database migration and query-layer alternatives for llame"
description: "Compares Drizzle v1, Kysely, migration-only replacement and other ORM options against llame's migration history, tenant isolation and PostgreSQL requirements."
tags: [database, drizzle, migrations, kysely, postgres, tenant-isolation]
status: draft
inspected: "2026-11-13"
sources:
  - id: llame-api-package
    resource: "https://github.com/leon0399/llame/blob/6eb012d0a2c2fc395184ccc734d8c4e586ee7601/apps/api/package.json"
    title: "llame API dependency declarations: Drizzle ORM 0.45.2 and Drizzle Kit 0.31.4"
  - id: llame-db-instructions
    resource: "https://github.com/leon0399/llame/blob/6eb012d0a2c2fc395184ccc734d8c4e586ee7601/apps/api/src/db/AGENTS.md"
    title: "llame database migration, RLS and provisioning conventions"
  - id: llame-tenant-service
    resource: "https://github.com/leon0399/llame/blob/6eb012d0a2c2fc395184ccc734d8c4e586ee7601/apps/api/src/db/tenant-db.service.ts"
    title: "llame tenant database service: transaction identity and execution boundary"
  - id: drizzle-upgrade-v1
    resource: "https://orm.drizzle.team/docs/upgrade-v1"
    title: "Drizzle ORM upgrade to v1 guide (live documentation; inspected 2026-11-13)"
  - id: drizzle-migrations-v1
    resource: "https://notes.drizzle.run/articles/migrations-v1/"
    title: "Drizzle migrations v1 article (live documentation; inspected 2026-11-13)"
  - id: kysely-migrations
    resource: "https://kysely.dev/docs/migrations"
    title: "Kysely migrations documentation (live documentation; inspected 2026-11-13)"
  - id: kysely-getting-started
    resource: "https://kysely.dev/docs/getting-started"
    title: "Kysely getting started documentation (live documentation; inspected 2026-11-13)"
  - id: kysely-codegen
    resource: "https://github.com/RobinBlomberg/kysely-codegen"
    title: "kysely-codegen project documentation (live repository; inspected 2026-11-13)"
  - id: node-pg-migrate
    resource: "https://salsita.github.io/node-pg-migrate/cli"
    title: "node-pg-migrate CLI documentation (live documentation; inspected 2026-11-13)"
  - id: knex-migrations
    resource: "https://knexjs.org/guide/migrations.html"
    title: "Knex migrations documentation (live documentation; inspected 2026-11-13)"
  - id: knex-typescript
    resource: "https://knexjs.org/guide/query-builder.html#usage-with-typescript"
    title: "Knex TypeScript query-builder documentation (live documentation; inspected 2026-11-13)"
  - id: typeorm-migrations
    resource: "https://typeorm.io/docs/migrations/setup/"
    title: "TypeORM migration setup documentation (live documentation; inspected 2026-11-13)"
  - id: sequelize-migrations
    resource: "https://sequelize.org/docs/v6/other-topics/migrations/"
    title: "Sequelize v6 migrations documentation"
  - id: prisma-migration-graph
    resource: "https://www.prisma.io/docs/orm/migrations/the-migration-graph"
    title: "Prisma migration graph documentation (live documentation; inspected 2026-11-13)"
  - id: prisma-release-status
    resource: "https://www.prisma.io/docs/orm/release-status"
    title: "Prisma ORM release-status documentation (live documentation; inspected 2026-11-13)"
---

# Database migration and query-layer alternatives for llame

## Finding

Evaluate Drizzle v1's revised migration format first. It is the smallest change that directly targets shared migration metadata and snapshot ancestry while retaining the current query layer. Kysely is the preferred full query-layer replacement if leaving Drizzle is independently desirable or the revised format fails real branch and upgrade scenarios. A migration-only change to node-pg-migrate is a narrower runtime change, but it separates deployed schema truth from Drizzle's TypeScript declarations and therefore needs a deterministic generation or drift-check process.[^drizzle-upgrade-v1][^kysely-migrations][^node-pg-migrate]

This is a comparative engineering judgment, not a completed migration trial. Library documentation and the repository inventory were reviewed; no alternative was installed or run against a database. Compatibility and performance are unmeasured.

## llame constraints and scope

The repository snapshot measured for this analysis contains 87 SQL migrations, 87 journal entries and 86 snapshots totaling 6,409,957 bytes. Seventy-three production TypeScript files under `apps/api/src` directly import `drizzle-orm`; the count excludes test/spec and testing paths. These are scope indicators, not effort estimates or conflict-frequency measurements. The migration without a snapshot was not investigated.[^llame-api-package][^llame-db-instructions]

Any replacement must preserve tenant isolation and operational behavior: enabled and forced row-level security, trusted transaction-local identity that fails closed, transactional migration semantics, backfills, SECURITY DEFINER provisioning, and explicit transaction isolation where used. Tenant transaction setup and its boundary are implemented in `TenantDbService`.[^llame-db-instructions][^llame-tenant-service]

## Candidate comparison

| Candidate                         | Fit and advantages                                                                                                                                                                                     | Costs and risks                                                                                                                                                                                                                                                                                     | Assessment                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drizzle v1 RC                     | Revised format groups SQL and snapshots by migration, removes the shared journal and adds noncommutativity detection. It addresses the reported shared-history conflict without a broad query rewrite. | RC upgrade changes migration paths and APIs/codecs; history conversion and existing-database behavior need proof. A commutativity check is not proof that arbitrary SQL or backfills are equivalent.                                                                                                | First to evaluate; do not adopt without conversion and upgrade tests. [^drizzle-upgrade-v1][^drizzle-migrations-v1]                                  |
| Kysely                            | Explicit SQL-shaped typed query API and standalone migrations; can use replayed SQL as schema truth and generate database interfaces.                                                                  | Broad query rewrite; custom JSON/domain typing and driver mappings need review. Default PostgreSQL dialect uses `pg`, unlike the existing `postgres.js` setup. Its default ordering check rejects a late older-named migration; allowing unordered migrations does not prove semantic independence. | Preferred full replacement if leaving Drizzle is a separate goal or Drizzle v1 fails. [^kysely-migrations][^kysely-getting-started][^kysely-codegen] |
| Drizzle runtime + node-pg-migrate | Smaller runtime cutover and SQL-first migrations for PostgreSQL security objects.                                                                                                                      | Schema declarations and deployed schema become separate sources of truth unless deterministic introspection or drift checks align them. Its ordering policy still requires a late-arrival decision. Keeping Drizzle Kit's existing generation/history would retain the original problem.            | Viable narrower alternative; select one migration owner after cutover, not a permanent dual-runner arrangement. [^node-pg-migrate]                   |
| Knex                              | Standalone migrations and a mature SQL-oriented API.                                                                                                                                                   | Its TypeScript documentation notes inference weaknesses in mutable chains and result-type overrides. No llame requirement identified outweighs Kysely's typing advantage.                                                                                                                           | No demonstrated reason to prefer it over Kysely. [^knex-migrations][^knex-typescript]                                                                |
| TypeORM                           | Entity-oriented schema and generated migration files; does not require Drizzle's journal.                                                                                                              | Significant model/query rewrite without a demonstrated need for entity-persistence semantics. NestJS integration alone is not sufficient justification.                                                                                                                                             | Not preferred for this SQL-heavy use case. [^typeorm-migrations]                                                                                     |
| Sequelize                         | Manually authored up/down migration files tracked through `SequelizeMeta`; model runtime is distinct from migration history.                                                                           | Query/model rewrite, without a demonstrated benefit from its model API.                                                                                                                                                                                                                             | No demonstrated advantage for llame. [^sequelize-migrations]                                                                                         |
| Prisma                            | Distinguish v7's timestamped SQL history from v8 RC's contract-state graph: the latter addresses branching.                                                                                            | Still needs merge migrations and preservation of manual data transformations. Release-status documentation lists transaction isolation-level support as missing, while llame uses explicit isolation settings.                                                                                      | Not the default replacement; reassess if the release boundary or required capabilities change. [^prisma-migration-graph][^prisma-release-status]     |

Fit judgments are moderate confidence. Documentation mechanics and the repository inventory are higher confidence; compatibility and performance remain unmeasured.

## Focused alternatives to bespoke migration infrastructure

The useful design principles from broader migration strategies are simple: represent independent changes as unique versioned files rather than a shared sequence index; keep schema changes and their migration ledger atomic where the runner supports it; serialize application safely without mistaking deployment locking for Git-branch conflict resolution; and validate tenant-security contracts independently of schema success. Prefer an established runner to building a custom queue, dependency-DAG runner, signing system or ranking mechanism merely to avoid a shared journal.[^kysely-migrations][^node-pg-migrate]

Separate expand/backfill/contract when application compatibility requires it. Use forward repairs with explicit preconditions rather than assuming a down migration can restore transformed data. These are useful operational patterns, not a requirement to add extra machinery to every migration.

## Decision experiment

Compare Drizzle v1 and Kysely on a disposable database copy, never on an owner's running database. Exercise:

- independent table changes and independent columns on one table across branches;
- a genuinely dependent rename and backfill;
- an older-named migration arriving after a newer one has already run;
- empty-database replay versus upgrade of an existing database;
- forced RLS with missing identity and another tenant's identity;
- explicit transaction isolation;
- bytea, JSON, timestamptz and bigint round trips.

For each, record required manual repairs, generated-metadata changes, final catalog and data equivalence, and failures that the tooling detects explicitly. These probes were proposed but not executed in the source analysis.

For Kysely, include one real transactional repository path and representative codec queries, then compare two-branch replay and a negative RLS case. For node-pg-migrate, establish fresh replay and existing-database history cutover on copies, then prove declaration/schema alignment and forced RLS. SQL-first schema ownership with generated typed raw queries is a further option only if representative Kysely queries add more complexity than they remove.

## Sources and method

The inventory describes llame at revision `6eb012d0a2c2fc395184ccc734d8c4e586ee7601`. Candidate mechanics come from project documentation inspected on 2026-11-13; live documentation may change. The comparison did not include a database rehearsal or performance benchmark.

[^llame-api-package]: [llame API package manifest at the inspected revision](https://github.com/leon0399/llame/blob/6eb012d0a2c2fc395184ccc734d8c4e586ee7601/apps/api/package.json).

[^llame-db-instructions]: [Database instructions at the inspected revision](https://github.com/leon0399/llame/blob/6eb012d0a2c2fc395184ccc734d8c4e586ee7601/apps/api/src/db/AGENTS.md), including migration and RLS conventions.

[^llame-tenant-service]: [TenantDbService at the inspected revision](https://github.com/leon0399/llame/blob/6eb012d0a2c2fc395184ccc734d8c4e586ee7601/apps/api/src/db/tenant-db.service.ts).

[^drizzle-upgrade-v1]: [Drizzle upgrade to v1](https://orm.drizzle.team/docs/upgrade-v1).

[^drizzle-migrations-v1]: [Drizzle migrations v1](https://notes.drizzle.run/articles/migrations-v1/).

[^kysely-migrations]: [Kysely migrations](https://kysely.dev/docs/migrations).

[^kysely-getting-started]: [Kysely getting started](https://kysely.dev/docs/getting-started).

[^kysely-codegen]: [kysely-codegen](https://github.com/RobinBlomberg/kysely-codegen).

[^node-pg-migrate]: [node-pg-migrate CLI](https://salsita.github.io/node-pg-migrate/cli).

[^knex-migrations]: [Knex migrations](https://knexjs.org/guide/migrations.html).

[^knex-typescript]: [Knex TypeScript usage](https://knexjs.org/guide/query-builder.html#usage-with-typescript).

[^typeorm-migrations]: [TypeORM migrations](https://typeorm.io/docs/migrations/setup/).

[^sequelize-migrations]: [Sequelize v6 migrations](https://sequelize.org/docs/v6/other-topics/migrations/).

[^prisma-migration-graph]: [Prisma migration graph](https://www.prisma.io/docs/orm/migrations/the-migration-graph).

[^prisma-release-status]: [Prisma release status](https://www.prisma.io/docs/orm/release-status).
