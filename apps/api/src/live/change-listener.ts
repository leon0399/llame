/**
 * The Postgres side of the live change hub: one LISTEN connection per API
 * process on `llame_changes`. postgres.js keeps the connection outside the
 * pool, reconnects with backoff, and calls `onListen` on every (re)connect.
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import postgres, { type Sql } from 'postgres';

import { LIVE_CHANGES_CHANNEL } from './live-messages';

export type ChangeListener = {
  listen(onNotify: (raw: string) => void, onListen: () => void): Promise<void>;
  close(): Promise<void>;
};

export const LIVE_CHANGE_LISTENER = Symbol('LIVE_CHANGE_LISTENER');

@Injectable()
export class PostgresChangeListener implements ChangeListener {
  private client: Sql | undefined;

  constructor(
    @Inject(ConfigService)
    private readonly config: Pick<ConfigService, 'get' | 'getOrThrow'>,
  ) {}

  async listen(
    onNotify: (raw: string) => void,
    onListen: () => void,
  ): Promise<void> {
    // Offline OpenAPI generation boots AppModule against no database.
    if (this.config.get<string>('LLAME_OPENAPI_GENERATION') === '1') return;
    this.client = postgres(this.config.getOrThrow<string>('POSTGRES_URL'), {
      max: 1,
    });
    await this.client.listen(LIVE_CHANGES_CHANNEL, onNotify, onListen);
  }

  async close(): Promise<void> {
    await this.client?.end({ timeout: 5 });
  }
}
