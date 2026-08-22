import {
  PeerSyncOutcomeUnknownError,
  type PeerSyncResult,
} from "./sync-client.js";

export type PeerSyncStatus =
  | { readonly peerId: string; readonly state: "idle" | "synchronizing" }
  | {
      readonly peerId: string;
      readonly state: "synchronized";
      readonly coverage: "verified-complete";
      readonly lastSuccessAt: string;
    }
  | {
      readonly peerId: string;
      readonly state: "degraded";
      readonly failure: "outcome_unknown" | "partial_coverage" | "unavailable";
      readonly lastAttemptAt: string;
    };

export interface PeerSyncSupervisorOptions {
  readonly peerId: string;
  readonly intervalMilliseconds: number;
  readonly sync: () => Promise<PeerSyncResult>;
  readonly now?: () => Date;
}

export class PeerSyncSupervisor {
  readonly #options: PeerSyncSupervisorOptions;
  #status: PeerSyncStatus;
  #running: Promise<void> | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #started = false;

  public constructor(options: PeerSyncSupervisorOptions) {
    this.#options = options;
    this.#status = { peerId: options.peerId, state: "idle" };
  }

  public snapshot(): PeerSyncStatus {
    return structuredClone(this.#status);
  }

  public runOnce(): Promise<void> {
    if (this.#running !== undefined) return this.#running;
    this.#status = { peerId: this.#options.peerId, state: "synchronizing" };
    const attemptAt = (this.#options.now ?? (() => new Date()))().toISOString();
    const running = this.#options
      .sync()
      .then((result) => {
        this.#status =
          result.coverage === "verified-complete"
            ? {
                peerId: this.#options.peerId,
                state: "synchronized",
                coverage: result.coverage,
                lastSuccessAt: attemptAt,
              }
            : {
                peerId: this.#options.peerId,
                state: "degraded",
                failure: "partial_coverage",
                lastAttemptAt: attemptAt,
              };
      })
      .catch((error: unknown) => {
        this.#status = {
          peerId: this.#options.peerId,
          state: "degraded",
          failure:
            error instanceof PeerSyncOutcomeUnknownError
              ? "outcome_unknown"
              : "unavailable",
          lastAttemptAt: attemptAt,
        };
      })
      .finally(() => {
        if (this.#running === running) this.#running = undefined;
      });
    this.#running = running;
    return running;
  }

  public start(): void {
    if (this.#started) return;
    this.#started = true;
    void this.#runAndSchedule();
  }

  public async stop(): Promise<void> {
    this.#started = false;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#running;
  }

  async #runAndSchedule(): Promise<void> {
    await this.runOnce();
    if (!this.#started) return;
    this.#timer = setTimeout(() => {
      void this.#runAndSchedule();
    }, this.#options.intervalMilliseconds);
  }
}
