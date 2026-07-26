import { COMMAND_EVENT, STATE_EVENT } from "../constants.js";
import type { VisualCommand } from "../shared/protocol.js";
import type { VisualRunState } from "../shared/results.js";

type StateChannel = {
  emit: (event: string, ...args: unknown[]) => unknown;
  off: (
    event: string,
    listener: (nextState: VisualRunState) => void,
  ) => unknown;
  on: (event: string, listener: (nextState: VisualRunState) => void) => unknown;
};

type RetryingProjection<T> = {
  dispose: () => void;
  project: (value: T) => void;
};

export function createRetryingProjection<T>(
  projectValue: (value: T) => void,
  isRetryable: (error: unknown) => boolean,
  retryMs = 250,
): RetryingProjection<T> {
  let disposed = false;
  let hasLatest = false;
  let latest: T;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const attempt = () => {
    retry = undefined;
    if (disposed || !hasLatest) return;

    const value = latest;
    try {
      projectValue(value);
      if (latest === value) hasLatest = false;
    } catch (error) {
      if (!isRetryable(error)) throw error;
      retry = globalThis.setTimeout(attempt, retryMs);
    }
  };

  return {
    dispose: () => {
      disposed = true;
      hasLatest = false;
      if (retry !== undefined) globalThis.clearTimeout(retry);
    },
    project: (value) => {
      latest = value;
      hasLatest = true;
      if (retry !== undefined) globalThis.clearTimeout(retry);
      attempt();
    },
  };
}

export function subscribeToVisualState(
  channel: StateChannel,
  onState: (state: VisualRunState) => void,
): () => void {
  let connected = false;
  let retry: ReturnType<typeof setInterval> | undefined;
  const handleState = (state: VisualRunState) => {
    connected = true;
    if (retry !== undefined) globalThis.clearInterval(retry);
    onState(state);
  };
  const requestState = () => {
    if (!connected) {
      channel.emit(COMMAND_EVENT, {
        type: "get-state",
      } satisfies VisualCommand);
    }
  };

  channel.on(STATE_EVENT, handleState);
  requestState();
  if (!connected) retry = globalThis.setInterval(requestState, 250);

  return () => {
    if (retry !== undefined) globalThis.clearInterval(retry);
    channel.off(STATE_EVENT, handleState);
  };
}
