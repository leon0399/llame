import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { DbModule } from './db/db.module';
import { InstanceConfigModule } from './instance-config/instance-config.module';
import { InstanceConfigService } from './instance-config/instance-config.service';
import { ToolPermissionPolicyModule } from './tools/permissions/permission-policy.module';

/**
 * CoreInfraModule — the cross-cutting infrastructure every entrypoint's own
 * NestFactory graph needs: env-file config loading, the operator config-as-
 * code loader (InstanceConfigModule; a bad llame.config.jsonc aborts bootstrap
 * before anything serves), the `DB_DEV` Drizzle connection (pool sized from
 * InstanceConfigService), and DbModule's TenantDbService. Previously
 * duplicated verbatim between AppModule (main.ts) and WorkerModule
 * (worker.ts, #116) — extracted here so the two entrypoints share ONE
 * definition instead of two copies that could silently drift. It also owns the
 * `DB_CREATION_LOCK` connection, which only the per-Chat creation lock uses.
 *
 * Database tokens are exported globally within each entrypoint's NestFactory
 * graph; each entrypoint imports this module once.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env.local',
    }),
    InstanceConfigModule,
    DbModule,
    ToolPermissionPolicyModule,
  ],
  providers: [
    {
      provide: 'DB_DEV',
      inject: [InstanceConfigService],
      useFactory: (instanceConfig: InstanceConfigService) =>
        drizzle({
          client: postgres(process.env.POSTGRES_URL!, {
            max: instanceConfig.config.db.poolSize,
          }),
        }),
    },
    {
      provide: 'DB_CREATION_LOCK',
      useFactory: () =>
        drizzle({
          client: postgres(process.env.POSTGRES_URL!, { max: 2 }),
        }),
    },
  ],
  exports: ['DB_DEV', 'DB_CREATION_LOCK'],
})
export class CoreInfraModule {}
