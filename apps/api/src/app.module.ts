import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DrizzlePostgresModule } from '@knaadh/nestjs-drizzle-postgres';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { ChatsModule } from './chats/chats.module';
import { DbModule } from './db/db.module';
import { RunsModule } from './runs/runs.module';
import { AuthModule } from './auth/auth.module';
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
    DbModule,
    ChatsModule,
    RunsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
