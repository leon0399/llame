import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as abortableDelay } from "node:timers/promises";

const packageRoot = process.cwd();
const fixtureSource = path.join(packageRoot, "test/fixtures/project");
const fixtureCopy = path.join(packageRoot, "test/.tmp/project");
const staticOutput = path.join(packageRoot, "test/.tmp/storybook-static");
const devPort = process.env.VISUAL_TEST_DEV_PORT ?? "6010";
const staticPort = process.env.VISUAL_TEST_STATIC_PORT ?? "6011";
const staticUrl = `http://127.0.0.1:${staticPort}/index.html`;
const gracefulShutdownTimeout = 5_000;
const staticReadyTimeout = 30_000;
const children = new Set<TrackedChild>();

type ChildExit = {
  code: number | null;
  error?: Error;
  signal: NodeJS.Signals | null;
};

type TrackedChild = {
  child: ChildProcess;
  exited: Promise<ChildExit>;
  processGroupId?: number;
};

let shutdownPromise: Promise<void> | undefined;

function spawnChild(args: string[]): TrackedChild {
  const useProcessGroup = process.platform !== "win32";
  const child = spawn("pnpm", args, {
    cwd: packageRoot,
    detached: useProcessGroup,
    stdio: "inherit",
  });
  const exited = new Promise<ChildExit>((resolve) => {
    let settled = false;

    const finish = (result: ChildExit) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    child.once("error", (error) => finish({ code: null, error, signal: null }));
    child.once("exit", (code, signal) => finish({ code, signal }));
  });
  const tracked = {
    child,
    exited,
    processGroupId: useProcessGroup ? child.pid : undefined,
  };

  children.add(tracked);

  return tracked;
}

async function cleanup(): Promise<void> {
  await Promise.all([
    rm(fixtureCopy, { recursive: true, force: true }),
    rm(staticOutput, { recursive: true, force: true }),
  ]);
}

function exitCode(result: ChildExit): number {
  return result.code && result.code > 0 ? result.code : 1;
}

function describeExit(name: string, result: ChildExit): string {
  if (result.error) {
    return `${name} failed to start: ${result.error.message}`;
  }

  if (result.signal) {
    return `${name} exited from ${result.signal}`;
  }

  return `${name} exited with code ${String(result.code)}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function processGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }

    throw error;
  }
}

async function waitForProcessGroupExit(
  processGroupId: number,
  timeout: number,
): Promise<boolean> {
  const deadline = Date.now() + timeout;

  while (processGroupExists(processGroupId)) {
    if (Date.now() >= deadline) {
      return false;
    }

    await delay(50);
  }

  return true;
}

function signalProcessGroup(
  processGroupId: number,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

async function terminateChild(
  tracked: TrackedChild,
  signal: NodeJS.Signals,
): Promise<void> {
  if (tracked.processGroupId !== undefined) {
    signalProcessGroup(tracked.processGroupId, signal);

    if (
      await waitForProcessGroupExit(
        tracked.processGroupId,
        gracefulShutdownTimeout,
      )
    ) {
      return;
    }

    signalProcessGroup(tracked.processGroupId, "SIGKILL");
    await waitForProcessGroupExit(
      tracked.processGroupId,
      gracefulShutdownTimeout,
    );
    return;
  }

  tracked.child.kill(signal);

  if (
    await Promise.race([
      tracked.exited.then(() => true),
      delay(gracefulShutdownTimeout).then(() => false),
    ])
  ) {
    return;
  }

  tracked.child.kill("SIGKILL");
  await Promise.race([tracked.exited, delay(gracefulShutdownTimeout)]);
}

function shutdown(code: number, signal: NodeJS.Signals = "SIGTERM") {
  shutdownPromise ??= (async () => {
    process.exitCode = code;
    await Promise.allSettled(
      [...children].map((child) => terminateChild(child, signal)),
    );
    await cleanup();
  })();

  return shutdownPromise;
}

function monitor(name: string, exited: Promise<ChildExit>): void {
  void exited.then((result) => {
    if (shutdownPromise) {
      return;
    }

    console.error(describeExit(name, result));
    void shutdown(exitCode(result));
  });
}

async function waitForStaticServer(signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + staticReadyTimeout;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(staticUrl, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(1_000)]),
      });

      if (response.ok) {
        return;
      }

      lastError = new Error(`received HTTP ${String(response.status)}`);
    } catch (error) {
      if (signal.aborted) {
        throw signal.reason;
      }

      lastError = error;
    }

    await abortableDelay(100, undefined, { signal });
  }

  throw new Error(
    `Static Storybook did not become ready: ${String(lastError)}`,
  );
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal === "SIGINT" ? 130 : 143, signal);
  });
}

async function main(): Promise<void> {
  await cleanup();
  await mkdir(path.dirname(fixtureCopy), { recursive: true });
  await cp(fixtureSource, fixtureCopy, { recursive: true });

  const build = spawnChild([
    "exec",
    "storybook",
    "build",
    "--config-dir",
    path.join(fixtureCopy, ".storybook"),
    "--output-dir",
    staticOutput,
    "--quiet",
  ]);
  const buildExit = await build.exited;
  children.delete(build);

  if (buildExit.code !== 0) {
    throw new Error(describeExit("Storybook build", buildExit));
  }

  const staticServer = spawnChild([
    "exec",
    "vite",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    staticPort,
    "--strictPort",
    "--outDir",
    staticOutput,
    "--logLevel",
    "warn",
  ]);
  const staticReadyController = new AbortController();
  try {
    await Promise.race([
      waitForStaticServer(staticReadyController.signal),
      staticServer.exited.then((result) => {
        throw new Error(describeExit("Vite preview", result));
      }),
    ]);
  } finally {
    staticReadyController.abort();
  }
  monitor("Vite preview", staticServer.exited);

  const storybook = spawnChild([
    "exec",
    "storybook",
    "dev",
    "--config-dir",
    path.join(fixtureCopy, ".storybook"),
    "--port",
    devPort,
    "--no-open",
  ]);
  monitor("Storybook dev", storybook.exited);
}

void main().catch(async (error: unknown) => {
  console.error(error);
  await shutdown(1);
});
