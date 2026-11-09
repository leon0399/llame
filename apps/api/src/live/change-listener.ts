/**
 * One Postgres LISTEN connection per consumer on one channel: the live change
 * hub on `llame_changes` and the run-control listener on `llame_run_control`.
 * postgres.js keeps the connection outside the pool, reconnects with backoff,
 * and calls `onListen` on every (re)connect.
 */

import type { ConfigService } from '@nestjs/config';
import postgres, { type Sql } from 'postgres';

export type ChangeListener = {
  listen(onNotify: (raw: string) => void, onListen: () => void): Promise<void>;
  close(): Promise<void>;
};

export const LIVE_CHANGE_LISTENER = Symbol('LIVE_CHANGE_LISTENER');

export class PostgresChangeListener implements ChangeListener {
  private client: Sql | undefined;

  constructor(
    private readonly config: Pick<ConfigService, 'get' | 'getOrThrow'>,
    private readonly channel: string,
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
    await this.client.listen(this.channel, onNotify, onListen);
  }

  async close(): Promise<void> {
    await this.client?.end({ timeout: 5 });
  }
}
