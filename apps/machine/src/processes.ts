/**
 * Every command this session started, so that ending the session can wait for
 * each one's process group to stop before the daemon leaves. `bash-executor`
 * kills the group when its abort signal fires and resolves the call only once
 * the group is gone, so awaiting the tracked call is the guarantee.
 */
export type BashProcesses = {
  track<T>(call: Promise<T>): Promise<T>;
  settled(): Promise<void>;
};

export function createBashProcesses(): BashProcesses {
  const running = new Set<Promise<unknown>>();
  return {
    track<T>(call: Promise<T>): Promise<T> {
      const tracked = call.finally(() => {
        running.delete(tracked);
      });
      running.add(tracked);
      return tracked;
    },
    async settled(): Promise<void> {
      await Promise.allSettled(running);
    },
  };
}
