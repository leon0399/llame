import { setTimeout as delay } from "node:timers/promises";

/** True when any process in the group still accepts a signal probe. */
export function processGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

export function signalProcessGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // Already gone.
  }
}

/** Wait until the process group is empty, or give up after `budgetMs`. */
export async function waitForProcessGroupQuiescence(
  pgid: number,
  budgetMs = 250,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (!processGroupAlive(pgid)) return true;
    await delay(10);
  }
  return !processGroupAlive(pgid);
}

export async function stopProcessGroup(pgid: number): Promise<boolean> {
  signalProcessGroup(pgid, "SIGKILL");
  return waitForProcessGroupQuiescence(pgid);
}
