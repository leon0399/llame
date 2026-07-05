import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DrizzlePostgresModule } from '@knaadh/nestjs-drizzle-postgres';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { ChatsModule } from './chats/chats.module';
import { DbModule } from './db/db.module';
import { RunsModule } from './runs/runs.module';
import { IdentityModule } from './identity/identity.module';
import { ConfigResolverModule } from './config-resolver/config-resolver.module';
import { AuthModule } from './auth/auth.module';
import { SessionAuthGuard } from './auth/session-auth.guard';
import * as schema from './db/schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env.local',
    }),
    DrizzlePostgresModule.registerAsync({
      tag: 'DB_DEV',
      useFactory: () => ({
        postgres: {
          url: process.env.POSTGRES_URL!,
          config: { max: 1 },
        },
        config: { schema: { ...schema } },
      }),
    }),
    // Rate limiting (#68): a generous instance-wide ceiling; the credential
    // endpoints carry much stricter per-route @Throttle overrides (each login
    // burns a bcrypt compare — an unbounded brute-force + DoS surface).
    // Uses req.ip, so TRUST_PROXY correctness feeds directly into fairness.
    // NOTE: counters are per-process in-memory — with api × N replicas the
    // effective ceiling is N× and resets on restart. Acceptable single-node;
    // a shared ThrottlerStorage becomes necessary with #116 (docs/scaling.md).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
    }),
    AuthModule,
    UsersModule,
    DbModule,
    ChatsModule,
    RunsModule,
    IdentityModule,
    ConfigResolverModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Guard order matters: rate limiting runs BEFORE session validation, so a
    // flood is rejected without paying the session lookup.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Fail-closed by default (#68): every controller route requires a verified
    // session unless explicitly @Public(). This global registration is THE
    // auth mechanism (per-route @UseGuards were removed so it is load-bearing
    // and proven by the 401 e2e tests) — a new controller added without
    // thinking about auth yields 401s, not a silently public endpoint.
    { provide: APP_GUARD, useClass: SessionAuthGuard },
  ],
})
export class AppModule {}
