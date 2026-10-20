import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_MISSES } from "./constants";

export type HeartbeatOptions = {
  /** Send one `ping` on the control stream. */
  readonly sendPing: () => void;
  /** The peer went silent for the whole miss window; the session ends. */
  readonly onLost: () => void;
  readonly intervalMs?: number;
  readonly misses?: number;
  readonly now?: () => number;
};

export type Heartbeat = {
  start(): void;
  /** One inbound frame: whatever it carried proves the peer is alive. */
  record(): void;
  stop(): void;
};

/**
 * The liveness side of a session: a `ping` every interval, and an end once no
 * inbound frame has arrived for `misses` of them. Both sides run one, so
 * either detects a silent peer.
 */
export function createHeartbeat(options: HeartbeatOptions): Heartbeat {
  const intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  const misses = options.misses ?? HEARTBEAT_MISSES;
  const now = options.now ?? (() => Date.now());
  let lastSeen = 0;
  let timer: NodeJS.Timeout | undefined;

  function stop(): void {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  return {
    start(): void {
      if (timer !== undefined) return;
      lastSeen = now();
      timer = setInterval(() => {
        if (now() - lastSeen >= intervalMs * misses) {
          stop();
          options.onLost();
          return;
        }
        options.sendPing();
      }, intervalMs);
      // Liveness never keeps the daemon alive on its own.
      timer.unref();
    },
    record(): void {
      lastSeen = now();
    },
    stop,
  };
}
