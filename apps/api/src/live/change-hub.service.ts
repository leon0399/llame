/**
 * ChangeHub — one Postgres LISTEN connection per API process, fanned out to
 * subscribers (the live WebSocket gateway).
 *
 * A notification is a pointer: routing uses the payload's owner, which the
 * trigger reads from the changed row, never from a caller. For an owner with
 * open connections the hub then reads the changed record as that owner
 * through `LiveRecordLoader` (row-level security applies) and sends it.
 * Reads run in notification order per owner; a notification for a record
 * whose read has not started yet is merged into that read, which then sees
 * the latest committed state. A failed read sends `resync`.
 *
 * An instance-wide record — a Machine, which every authenticated user may
 * read — has no owner in its payload. It is sent to every connection, and its
 * read runs without an identity (see `MachinesStatusRepository.findForLive`).
 *
 * Every outgoing message is serialized and validated against the generated
 * wire schema, so the server cannot send a shape `asyncapi.websocket.yaml` does not
 * describe.
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

import { LIVE_CHANGE_LISTENER, type ChangeListener } from './change-listener';
import { liveMessageSchema } from './generated/live-protocol';
import {
  parseChangeNotification,
  recordJobFor,
  RunProgressTracker,
  type ChangeNotification,
  type LiveMessage,
  type RecordJob,
  type ServerLiveMessage,
} from './live-messages';
import {
  LIVE_RECORD_LOADER,
  type LiveRecordLoader,
} from './live-record-loader';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { heartbeatSeconds } from '../runs/run-queues';

/** Receives one serialized, schema-valid message frame. */
type LiveSubscriber = (frame: string) => void;

/**
 * The audience for instance-wide records: every open connection. A symbol, so
 * no user id can ever be mistaken for it.
 */
const INSTANCE_AUDIENCE = Symbol('instance');

type Audience = string | typeof INSTANCE_AUDIENCE;

/** What the gateway needs from the hub. */
export type ChangeHubSubscriptions = Pick<
  ChangeHubService,
  'subscribe' | 'subscribeInstance'
>;

type SendQueue = { jobs: Array<RecordJob>; waiting: Set<string> };

type JobProjectionRefresh = {
  generation: number;
  busy: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  lastSentCounts: Map<string, number>;
};

/** The wire form of a message, or `undefined` when it violates the schema. */
export function toWireMessage(
  message: ServerLiveMessage,
): LiveMessage | undefined {
  const wire: unknown = JSON.parse(JSON.stringify(message));
  const parsed = liveMessageSchema.safeParse(wire);

  return parsed.success ? parsed.data : undefined;
}

@Injectable()
export class ChangeHubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChangeHubService.name);
  private readonly subscribers = new Map<string, Set<LiveSubscriber>>();
  private readonly instanceSubscribers = new Set<LiveSubscriber>();
  private readonly tracker = new RunProgressTracker();
  private readonly queues = new Map<Audience, SendQueue>();
  private readonly jobProjections = new Map<string, JobProjectionRefresh>();
  private listenCount = 0;

  constructor(
    @Inject(LIVE_CHANGE_LISTENER)
    private readonly listener: ChangeListener,
    @Inject(LIVE_RECORD_LOADER)
    private readonly loader: LiveRecordLoader,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.listener.listen(
      (raw) => this.dispatch(raw),
      () => this.onListen(),
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.subscribers.clear();
    this.instanceSubscribers.clear();
    this.queues.clear();

    for (const owner of this.jobProjections.keys())
      this.stopJobProjection(owner);
    this.jobProjections.clear();
    await this.listener.close();
  }

  /** Register one owner's subscriber; returns the unsubscribe function. */
  subscribe(ownerId: string, subscriber: LiveSubscriber): () => void {
    const set = this.subscribers.get(ownerId) ?? new Set<LiveSubscriber>();
    set.add(subscriber);
    this.subscribers.set(ownerId, set);
    this.seedJobProjection(ownerId, true);

    return () => {
      set.delete(subscriber);

      if (set.size === 0) {
        this.subscribers.delete(ownerId);
        this.stopJobProjection(ownerId);
      }
    };
  }

  /**
   * Register a subscriber for instance-wide records (every open connection);
   * returns the unsubscribe function.
   */
  subscribeInstance(subscriber: LiveSubscriber): () => void {
    this.instanceSubscribers.add(subscriber);

    return () => {
      this.instanceSubscribers.delete(subscriber);
    };
  }

  /** Handle one NOTIFY payload. */
  dispatch(raw: string): void {
    const notification = parseChangeNotification(raw);

    if (!notification) {
      this.logger.warn('Dropped malformed live change notification');

      return;
    }

    if (notification.k === 'machine') {
      this.dispatchInstance(notification);

      return;
    }

    // Fold every notification, even for owners with no subscriber, so the
    // tracker's state stays current for when one connects.
    const progress = this.tracker.apply(notification);

    if (progress) this.send(notification.owner, progress);

    // Records are read only for an owner someone is listening to.
    if (!this.subscribers.has(notification.owner)) return;

    if (notification.k === 'chat_jobs')
      this.seedJobProjection(notification.owner, false);
    const job = recordJobFor(notification);

    if (job) this.enqueue(notification.owner, job);
  }

  /** Fan one instance-wide record out to every open connection. */
  private dispatchInstance(
    notification: Extract<ChangeNotification, { k: 'machine' }>,
  ): void {
    if (this.instanceSubscribers.size === 0) return;
    const job = recordJobFor(notification);

    if (job) this.enqueue(INSTANCE_AUDIENCE, job);
  }

  private enqueue(audience: Audience, job: RecordJob): void {
    const existing = this.queues.get(audience);
    const queue = existing ?? { jobs: [], waiting: new Set<string>() };

    if (job.key !== undefined) {
      if (queue.waiting.has(job.key)) return;
      queue.waiting.add(job.key);
    }

    queue.jobs.push(job);

    if (existing) return;
    this.queues.set(audience, queue);
    void this.drain(audience, queue);
  }

  private async drain(audience: Audience, queue: SendQueue): Promise<void> {
    for (let job = queue.jobs.shift(); job; job = queue.jobs.shift()) {
      if (job.key !== undefined) queue.waiting.delete(job.key);

      const subscribers =
        audience === INSTANCE_AUDIENCE
          ? undefined
          : this.subscribers.get(audience);

      try {
        const message = await job.load(this.loader);

        const currentSubscribers =
          audience === INSTANCE_AUDIENCE
            ? undefined
            : this.subscribers.get(audience);

        if (
          message?.type === 'chat.upserted' &&
          subscribers !== currentSubscribers
        ) {
          this.send(audience, { type: 'resync' });
        } else if (message) {
          this.send(audience, message);
        }
      } catch (error) {
        this.logger.warn(
          `Live record read failed; requesting resync: ${error instanceof Error ? error.message : 'unknown'}`,
        );
        this.send(audience, { type: 'resync' });
      }
    }

    this.queues.delete(audience);
  }

  private onListen(): void {
    this.listenCount += 1;

    if (this.listenCount === 1) return;
    this.logger.warn('Live change listener reconnected; requesting resync');

    // A socket also holds an instance subscription, and its client refetches
    // instance-wide lists on any `resync`, so the owner stream covers it.
    for (const owner of this.subscribers.keys()) {
      this.send(owner, { type: 'resync' });
      this.seedJobProjection(owner, true);
    }
  }

  private seedJobProjection(owner: string, resetBaseline: boolean): void {
    if (!this.subscribers.has(owner)) return;

    const state = this.jobProjections.get(owner) ?? {
      generation: 0,
      busy: false,
      timer: undefined,
      lastSentCounts: new Map<string, number>(),
    };

    clearTimeout(state.timer);
    state.timer = undefined;
    state.generation += 1;

    if (resetBaseline) state.lastSentCounts.clear();
    this.jobProjections.set(owner, state);

    if (!state.busy) void this.refreshJobProjection(owner, state);
  }

  private async refreshJobProjection(
    owner: string,
    state: JobProjectionRefresh,
  ): Promise<void> {
    state.busy = true;
    const generation = state.generation;

    const nextRefreshAt =
      performance.now() + heartbeatSeconds(this.instanceConfig.config) * 1000;

    let repeat = true;

    try {
      const counts = await this.loader.runningJobs(owner);

      if (state.generation !== generation || !this.subscribers.has(owner))
        return;
      repeat = counts.size > 0;

      for (const [chat, count] of counts) {
        if (state.lastSentCounts.get(chat) === count) continue;
        const job = recordJobFor({ k: 'chat_jobs', owner, chat });

        if (job) this.enqueue(owner, job);
      }
    } catch {
      if (state.generation === generation && this.subscribers.has(owner))
        this.send(owner, { type: 'resync' });
    } finally {
      state.busy = false;

      if (!this.subscribers.has(owner)) {
        this.jobProjections.delete(owner);
      } else if (state.generation !== generation) {
        void this.refreshJobProjection(owner, state);
      } else if (repeat) {
        state.timer = setTimeout(
          () => {
            state.timer = undefined;
            void this.refreshJobProjection(owner, state);
          },
          Math.max(0, nextRefreshAt - performance.now()),
        );
      }
    }
  }

  private stopJobProjection(owner: string): void {
    const state = this.jobProjections.get(owner);

    if (!state) return;
    state.generation += 1;
    clearTimeout(state.timer);
    state.timer = undefined;
    state.lastSentCounts.clear();

    // Keep an in-flight read until it releases busy, including a resubscribe.
    if (!state.busy) this.jobProjections.delete(owner);
  }

  private send(audience: Audience, message: ServerLiveMessage): void {
    const subscribers =
      audience === INSTANCE_AUDIENCE
        ? this.instanceSubscribers
        : this.subscribers.get(audience);

    if (!subscribers || subscribers.size === 0) return;
    const wire = toWireMessage(message);

    if (!wire) {
      this.logger.error(
        `Dropped a ${message.type} message that violates asyncapi.websocket.yaml`,
      );

      // The client stopped polling while connected; have it refetch instead.
      if (message.type !== 'resync') this.send(audience, { type: 'resync' });

      return;
    }

    if (audience !== INSTANCE_AUDIENCE) {
      const counts = this.jobProjections.get(audience)?.lastSentCounts;

      if (wire.type === 'chat.upserted')
        counts?.set(wire.chat.id, wire.chat.runningJobs);
      else if (wire.type === 'chat.deleted') counts?.delete(wire.chatId);
    }

    // Serialized once per audience, not once per socket.
    const frame = JSON.stringify(wire);

    for (const subscriber of subscribers) {
      try {
        subscriber(frame);
      } catch (error) {
        this.logger.warn(
          `Live subscriber failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
  }
}
