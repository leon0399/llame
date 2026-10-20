import { rootsFileFor } from "./env";
import { addRoot, readRoots, removeRoot } from "./roots";
import {
  serveMachine,
  type MachineSession,
  type ServeMachineOptions,
  type SessionEndReason,
} from "./serve";
import { DAEMON_VERSION } from "./version";

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_INCOMPATIBLE_VERSION = 2;
export const EXIT_PROTOCOL_ERROR = 3;

/** What the CLI writes to, and the daemon runner a test can stand in for. */
export type CliEnvironment = {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  /** The `serve` runner; the default daemon serves the process's own stdio. */
  readonly serve?: (options: ServeMachineOptions) => MachineSession;
};

const USAGE = `Usage:
  llame-machine serve --stdio        Serve one hub session on stdin and stdout
  llame-machine roots add <dir>      Register a directory this Machine serves
  llame-machine roots remove <dir>   Unregister a directory
  llame-machine roots list           List the registered directories
  llame-machine --version            Print the daemon version
`;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unexpected failure";
}

/** Why a session ended decides the process status the hub reads. */
export function exitCodeFor(reason: SessionEndReason): number {
  if (reason === "incompatible_version") return EXIT_INCOMPATIBLE_VERSION;
  if (reason === "protocol_error") return EXIT_PROTOCOL_ERROR;
  return EXIT_OK;
}

function rootsCommand(
  args: ReadonlyArray<string>,
  environment: CliEnvironment,
): number {
  const [action, directory] = args;
  if (action === "list" && directory === undefined) {
    for (const root of readRoots(rootsFileFor())) environment.out(`${root}\n`);
    return EXIT_OK;
  }
  if (directory === undefined || (action !== "add" && action !== "remove")) {
    environment.err(USAGE);
    return EXIT_USAGE;
  }
  try {
    const changed =
      action === "add"
        ? addRoot(rootsFileFor(), directory)
        : removeRoot(rootsFileFor(), directory);
    environment.out(`${changed}\n`);
    return EXIT_OK;
  } catch (error) {
    environment.err(`llame-machine: ${messageOf(error)}\n`);
    return EXIT_USAGE;
  }
}

async function serveCommand(
  args: ReadonlyArray<string>,
  environment: CliEnvironment,
): Promise<number> {
  if (args.length !== 1 || args[0] !== "--stdio") {
    environment.err(USAGE);
    return EXIT_USAGE;
  }
  const session =
    environment.serve === undefined
      ? serveMachine(process.stdin, process.stdout)
      : environment.serve({});
  return exitCodeFor(await session.done);
}

export async function runCli(
  argv: ReadonlyArray<string>,
  environment: CliEnvironment,
): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "serve") return serveCommand(rest, environment);
  if (command === "roots") return rootsCommand(rest, environment);
  if (command === "--version") {
    environment.out(`${DAEMON_VERSION}\n`);
    return EXIT_OK;
  }
  environment.err(USAGE);
  return EXIT_USAGE;
}

/** The process's own stdio and the real daemon behind `serve`. */
export async function runMain(argv: ReadonlyArray<string>): Promise<number> {
  const environment: CliEnvironment = {
    out: (text) => {
      process.stdout.write(text);
    },
    err: (text) => {
      process.stderr.write(text);
    },
  };
  try {
    const code = await runCli(argv, environment);
    process.exitCode = code;
    return code;
  } catch (error) {
    environment.err(`llame-machine: ${messageOf(error)}\n`);
    process.exitCode = EXIT_USAGE;
    return EXIT_USAGE;
  }
}
