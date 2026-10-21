/**
 * Restarting one fixture container (remote-machines task 4.2): a stopped box is
 * started again through the Docker CLI, because Testcontainers caches its own
 * `stop` on the handle it hands out, and readiness is the listener, not a log
 * line the second boot no longer writes.
 */

import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { type StartedTestContainer } from 'testcontainers';

/** How long a container may take to serve sshd again. */
export const SSHD_STARTUP_MS = 60_000;

const SSHD_POLL_MS = 200;

/**
 * Stop a container the suite means to start again. Testcontainers caches its
 * own `stop` on the handle it handed out — a later `stop` from `dispose` would
 * then be a no-op and leak the container — so this stops through the Docker
 * CLI, which leaves `startForRestart` and teardown working.
 */
export function stopForRestart(container: StartedTestContainer): void {
  execFileSync('docker', ['stop', container.getId()], { stdio: 'ignore' });
}

/** Whether that container's sshd accepts a connection yet. */
async function sshdListens(container: StartedTestContainer): Promise<boolean> {
  // bash's /dev/tcp is the probe: it is the same TCP handshake the hub makes,
  // and it needs nothing installed in the image.
  const probe = await container.exec([
    'bash',
    '-c',
    'exec 3<>/dev/tcp/127.0.0.1/22',
  ]);
  return probe.exitCode === 0;
}

/**
 * Start that container again and wait until its sshd accepts a connection,
 * which is what the hub needs before it retries.
 */
export async function startForRestart(
  container: StartedTestContainer,
): Promise<void> {
  execFileSync('docker', ['start', container.getId()], { stdio: 'ignore' });
  const deadline = Date.now() + SSHD_STARTUP_MS;
  while (Date.now() < deadline) {
    if (await sshdListens(container)) return;
    await delay(SSHD_POLL_MS);
  }
  throw new Error(
    `${container.getName()} did not serve sshd within ${String(SSHD_STARTUP_MS)}ms of starting.`,
  );
}

/** Start a container this suite stopped, for the tests that follow it. */
export async function ensureRunning(
  container: StartedTestContainer,
): Promise<void> {
  try {
    await container.exec(['true']);
    return;
  } catch (error) {
    // A container the previous test stopped is expected; anything else says so
    // through the failure of the start below.
    console.warn(
      `[machine-sshd] starting ${container.getName()} for the next test:`,
      error instanceof Error ? error.message : String(error),
    );
  }
  await startForRestart(container);
}
