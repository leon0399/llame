/**
 * ChangeHub — one Postgres LISTEN connection per API process, fanned out to
 * owner-scoped subscribers (the live WebSocket gateway).
 *
 * The hub performs no database reads: owner, record ids and run progress all
 * come from the trigger's pointer payload, so the listener connection never
 * needs a tenant identity. Routing is by the payload's owner, which the
 * trigger reads from the changed row, never from a caller.
 *
 * Notifications sent while the listener was disconnected are lost. postgres.js
 * reconnects with backoff and calls `onlisten` on every (re)connect; after the
 * first, the hub sends `resync` so clients refetch what they may have missed.
 */

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import postgres, { type Sql } from 'postgres';

import {
  LIVE_CHANGES_CHANNEL,
  parseChangeNotification,
  RunProgressTracker,
  type LiveMessage,
} from './live-messages';

export type LiveSubscriber = (message: LiveMessage) => void;

/** What the gateway needs from the hub. */
export type ChangeHubSubscriptions = Pick<ChangeHubService, 'subscribe'>;

@Injectable()
export class ChangeHubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChangeHubService.name);
  private readonly subscribers = new Map<string, Set<LiveSubscriber>>();
  private readonly tracker = new RunProgressTracker();
  private client: Sql | undefined;
  private listenCount = 0;

  constructor(
    @Inject(ConfigService)
    private readonly config: Pick<ConfigService, 'get' | 'getOrThrow'>,
  ) {}

  async onModuleInit(): Promise<void> {
    // Offline OpenAPI generation boots AppModule against no database.
    if (this.config.get<string>('LLAME_OPENAPI_GENERATION') === '1') return;
    this.client = postgres(this.config.getOrThrow<string>('POSTGRES_URL'), {
      max: 1,
    });
    await this.client.listen(
      LIVE_CHANGES_CHANNEL,
      (raw) => this.dispatch(raw),
      () => this.onListen(),
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.subscribers.clear();
    await this.client?.end({ timeout: 5 });
  }

  /** Register one owner's subscriber; returns the unsubscribe function. */
  subscribe(ownerId: string, subscriber: LiveSubscriber): () => void {
    const set = this.subscribers.get(ownerId) ?? new Set<LiveSubscriber>();
    set.add(subscriber);
    this.subscribers.set(ownerId, set);
    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(ownerId);
    };
  }

  /** Handle one NOTIFY payload. Public for the hub's routing test. */
  dispatch(raw: string): void {
    const notification = parseChangeNotification(raw);
    if (!notification) {
      this.logger.warn('Dropped malformed live change notification');
      return;
    }
    // Fold every notification, even for owners with no subscriber, so the
    // run tracker's state stays current for when one connects.
    const message = this.tracker.apply(notification);
    if (!message) return;
    this.send(notification.owner, message);
  }

  private onListen(): void {
    this.listenCount += 1;
    if (this.listenCount === 1) return;
    this.logger.warn('Live change listener reconnected; requesting resync');
    for (const owner of this.subscribers.keys()) {
      this.send(owner, { type: 'resync' });
    }
  }

  private send(ownerId: string, message: LiveMessage): void {
    for (const subscriber of this.subscribers.get(ownerId) ?? []) {
      try {
        subscriber(message);
      } catch (error) {
        this.logger.warn(
          `Live subscriber failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
  }
}
