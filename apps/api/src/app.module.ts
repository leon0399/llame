import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { DrizzlePostgresModule } from '@knaadh/nestjs-drizzle-postgres';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { ChatsModule } from './chats/chats.module';
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
    AuthModule,
    UsersModule,
    ChatsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Fail-closed by default (#68): every controller route requires a verified
    // session unless explicitly @Public(). This global registration is THE
    // auth mechanism (per-route @UseGuards were removed so it is load-bearing
    // and proven by the 401 e2e tests) — a new controller added without
    // thinking about auth yields 401s, not a silently public endpoint.
    { provide: APP_GUARD, useClass: SessionAuthGuard },
  ],
})
export class AppModule {}
