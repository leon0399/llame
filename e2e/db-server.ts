import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rlsFunctionOwnerSqlPath = resolve(
  repoRoot,
  "docker/postgres/rls-function-owner.sql",
);
const container = process.env.E2E_DB_CONTAINER ?? "llame-e2e-postgres";
const image = process.env.E2E_DB_PG_IMAGE ?? "postgres:17-alpine";
const dbPort = process.env.E2E_DB_PORT ?? "55433";
const readyPort = Number(process.env.E2E_DB_READY_PORT ?? "4302");
const postgresUrl =
  process.env.POSTGRES_URL ??
  `postgres://app:app@localhost:${dbPort}/llame_e2e`;
const databaseName = new URL(postgresUrl).pathname.replace(/^\//, "");

let server: Server | undefined;
let shuttingDown = false;
let resolveShutdown: (() => void) | undefined;
const shutdown = new Promise<void>((resolve) => {
  resolveShutdown = resolve;
});

function requestShutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  resolveShutdown?.();
}

process.once("SIGINT", requestShutdown);
process.once("SIGTERM", requestShutdown);

function run(
  command: string,
  args: string[],
  options: SpawnSyncOptions = {},
): void {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function runWithInput(command: string, args: string[], input: string): void {
  run(command, args, {
    input,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

async function cleanup(): Promise<void> {
  try {
    const readyServer = server;
    server = undefined;

    if (!readyServer) return;

    await new Promise<void>((resolve, reject) => {
      readyServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  } finally {
    spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
  }
}

async function waitForPostgres(): Promise<void> {
  process.stdout.write("waiting for postgres");

  // During first boot, initdb runs a TEMPORARY server that answers pg_isready,
  // then restarts into the real one — a single success can land in that gap.
  // Require consecutive successes so we only proceed once the restart is done.
  const requiredConsecutive = 3;
  let consecutive = 0;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = spawnSync(
      "docker",
      ["exec", container, "pg_isready", "-U", "postgres"],
      { stdio: "ignore" },
    );

    if (result.status === 0) {
      consecutive += 1;
      if (consecutive >= requiredConsecutive) {
        process.stdout.write(" ready\n");
        return;
      }
    } else {
      consecutive = 0;
      process.stdout.write(".");
    }

    await sleep(500);
  }

  process.stdout.write(" timeout\n");
  throw new Error("Postgres did not become ready within 60s");
}

function provisionDatabase(): void {
  runWithInput(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    `
CREATE ROLE app LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE ${databaseName} OWNER app;
-- org-units (D4): the BYPASSRLS role llame_role_on_unit_path must run as, so
-- memberships policies can check "member/admin on the unit's path" without
-- RLS recursion. Mirrors docker/postgres/initdb/02-app-rls-role.sql — not
-- mounted here, since this script provisions its own throwaway container
-- rather than using compose's initdb hooks.
CREATE ROLE app_rls WITH NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
`,
  );

  runWithInput(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
    ],
    "ALTER SCHEMA public OWNER TO app;\n",
  );
}

function migrateDatabase(): void {
  run("pnpm", ["--filter", "api", "db:migrate"], {
    env: { ...process.env, POSTGRES_URL: postgresUrl },
  });
}

// Mirrors `pnpm db:provision-rls` (docker/postgres/rls-function-owner.sql,
// run as the `postgres` superuser) — required after every migrate that
// (re)creates `llame_role_on_unit_path`. Until this runs, the function stays
// owned by `app`, does NOT bypass FORCE RLS, and every roster/admin
// membership op silently sees zero rows (org-units D4). Read from the source
// file rather than duplicated inline, so it can't drift from the real
// provisioning step.
function provisionRlsFunctionOwner(): void {
  const sql = fs.readFileSync(rlsFunctionOwnerSqlPath, "utf8");
  runWithInput(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
    ],
    sql,
  );
}

async function startReadyServer(): Promise<void> {
  server = createServer((request, response) => {
    if (request.url === "/ready") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(readyPort, "127.0.0.1", resolve);
  });

  console.log(`e2e database ready on ${postgresUrl}`);
}

async function waitForShutdown(): Promise<void> {
  await shutdown;
}

async function main(): Promise<void> {
  try {
    await cleanup();
    run("docker", [
      "run",
      "-d",
      "--name",
      container,
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-p",
      `${dbPort}:5432`,
      image,
    ]);
    if (shuttingDown) return;
    await waitForPostgres();
    if (shuttingDown) return;
    provisionDatabase();
    if (shuttingDown) return;
    migrateDatabase();
    if (shuttingDown) return;
    provisionRlsFunctionOwner();
    if (shuttingDown) return;
    await startReadyServer();
    await waitForShutdown();
  } finally {
    await cleanup();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
