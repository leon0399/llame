/** One reserved unit of a {@link BashProcessLimiter}. */
export type ManagedProcessSlot = {
  readonly release: () => void;
};

/**
 * Counts the managed commands of one worker process. A slot is held from
 * admission to the settlement of the command, in the foreground or the
 * background. The owner builds one limiter and passes it to every caller that
 * runs a command, so the bound holds whatever the target.
 */
export class BashProcessLimiter {
  #active = 0;

  constructor(readonly maxProcesses: number) {}

  /** A slot, or `null` when `maxProcesses` commands already run. */
  tryAcquire(): ManagedProcessSlot | null {
    if (this.#active >= this.maxProcesses) return null;
    this.#active += 1;
    let released = false;

    return {
      release: () => {
        if (released) return;
        released = true;
        this.#active -= 1;
      },
    };
  }
}
