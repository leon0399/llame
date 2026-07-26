import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";

const packageRoot = process.cwd();
const fixtureSource = path.join(packageRoot, "test/fixtures/project");
const fixtureCopy = path.join(packageRoot, "test/.tmp/project");
const staticOutput = path.join(packageRoot, "test/.tmp/storybook-static");
const devPort = process.env.VISUAL_TEST_DEV_PORT ?? "6010";
const staticPort = process.env.VISUAL_TEST_STATIC_PORT ?? "6011";
const gracefulShutdownTimeout = 5_000;
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
let staticServer: Server | undefined;

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

async function closeStaticServer(): Promise<void> {
  if (!staticServer) return;

  const server = staticServer;
  staticServer = undefined;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
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
    await closeStaticServer();
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

async function startStaticServer(): Promise<void> {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const relativePath =
        decodeURIComponent(url.pathname) === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname).slice(1);
      const filePath = path.resolve(staticOutput, relativePath);
      if (
        filePath !== staticOutput &&
        !filePath.startsWith(`${staticOutput}${path.sep}`)
      ) {
        response.writeHead(403).end();
        return;
      }

      const body = await readFile(filePath);
      response
        .writeHead(200, {
          "Content-Type": contentType(filePath),
        })
        .end(body);
    } catch (error) {
      response
        .writeHead(
          (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500,
        )
        .end();
    }
  });
  staticServer = server;

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(Number(staticPort), "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    if (staticServer === server) staticServer = undefined;
    throw error;
  }
  server.on("error", (error) => {
    if (shutdownPromise) return;
    console.error(`Static Storybook server failed: ${error.message}`);
    void shutdown(1);
  });
}

function contentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal === "SIGINT" ? 130 : 143, signal);
  });
}

async function main(): Promise<void> {
  await cleanup();
  if (shutdownPromise) return;
  await mkdir(path.dirname(fixtureCopy), { recursive: true });
  if (shutdownPromise) return;
  await cp(fixtureSource, fixtureCopy, { recursive: true });
  if (shutdownPromise) return;

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
  if (shutdownPromise) return;

  if (buildExit.code !== 0) {
    throw new Error(describeExit("Storybook build", buildExit));
  }

  await startStaticServer();
  if (shutdownPromise) return;

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
