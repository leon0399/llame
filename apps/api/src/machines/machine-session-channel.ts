import { type JsonValue } from '@workspace/machine-protocol';
import { type MachineFailureReason } from './machines-status';

export type MachineSessionEndReason = MachineFailureReason | 'closed';

export type MachineSessionEnd = {
  readonly reason: MachineSessionEndReason;
  readonly established: boolean;
};

export type MachineNotification = {
  readonly method: string;
  readonly params?: JsonValue;
};

export type MachineChannel = {
  readonly closed: boolean;
  close(): void;
  onClose(callback: () => void): void;
  onNotification(callback: (notification: MachineNotification) => void): void;
  notify(method: string, params?: JsonValue): void;
};

export type MachineChannelHandle = {
  readonly channel: MachineChannel;
  readonly result: Promise<JsonValue>;
};

export function createChannel(release: () => void) {
  const listeners: Array<(notification: MachineNotification) => void> = [];
  const closeListeners: Array<() => void> = [];
  let closed = false;

  const channel: MachineChannel = {
    get closed() {
      return closed;
    },
    close: () => {
      if (closed) return;

      closed = true;
      release();
      closeListeners.forEach((listener) => listener());
    },
    onClose: (callback) => {
      closeListeners.push(callback);

      if (closed) callback();
    },
    onNotification: (callback) => listeners.push(callback),
    notify: () => undefined,
  };

  return {
    channel,
    notify: (notification: MachineNotification) =>
      listeners.forEach((listener) => listener(notification)),
  };
}
