import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CoreInfraModule } from './core-infra.module';
import { UsersModule } from './users/users.module';
import { ChatsModule } from './chats/chats.module';
import { PinsModule } from './pins/pins.module';
import { ProjectsModule } from './projects/projects.module';
import { RunsModule } from './runs/runs.module';
import { SearchModule } from './search/search.module';
import { IdentityModule } from './identity/identity.module';
import { AuthModule } from './auth/auth.module';
import { MemoryModule } from './memory/memory.module';
import { PersonalizationModule } from './personalization/personalization.module';
import { SessionAuthGuard } from './auth/session-auth.guard';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { CanonicalSearchActivationService } from './search/canonical-search-activation.service';

// Global per-IP request ceiling per minute. Env-tunable for the same reason
// AUTH_RATE_LIMIT_PER_MINUTE is (auth/constants.ts): the browser e2e harness
// drives many parallel workers — page loads, history fetches, run polling —
// from ONE IP, so the production-strict default starves it. Read once at
// boot, like its auth counterpart; production keeps the default.
const API_RATE_LIMIT_PER_MINUTE = (() => {
  // eslint-disable-next-line anti-slop/forbid-process-env-outside-env-ts -- pending migration into llame.config.json: this is a product setting read as a bare env var, which skips schema validation and secret marking. Tracked in docs/research/lint/2026-08-31-stella-oxlint-plugins.md.
  const raw = Number(process.env.API_RATE_LIMIT_PER_MINUTE);
  return Number.isInteger(raw) && raw > 0 ? raw : 300;
})();

@Module({
  imports: [
    // Config-as-code loading, DB_DEV, TenantDbService (core-infra.module.ts) —
    // shared with the dedicated worker entrypoint (worker.module.ts, #116).
    CoreInfraModule,
    // Rate limiting (#68): a generous instance-wide ceiling; the credential
    // endpoints carry much stricter per-route @Throttle overrides (each login
    // burns a bcrypt compare — an unbounded brute-force + DoS surface).
    // Uses req.ip, so TRUST_PROXY correctness feeds directly into fairness.
    // NOTE: counters are per-process in-memory — with api × N replicas the
    // effective ceiling is N× and resets on restart. Acceptable single-node;
    // a shared ThrottlerStorage becomes necessary with #116 (docs/scaling.md).
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'default', ttl: 60_000, limit: API_RATE_LIMIT_PER_MINUTE },
      ],
    }),
    AuthModule,
    UsersModule,
    ChatsModule,
    ProjectsModule,
    PinsModule,
    MemoryModule,
    PersonalizationModule,
    RunsModule,
    SearchModule,
    IdentityModule,
    KnowledgeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    CanonicalSearchActivationService,
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
