import { NodeProtocolError } from "@workspace/node-protocol";
import { environment } from "@workspace/personal-node/env";
import { CliError } from "@workspace/personal-node/errors";
import { Application } from "./application";
import { argumentsFor, help } from "./arguments";
import { Output } from "./output";

async function main(): Promise<void> {
  const env = environment();
  // Lockfiles, SQLite journals and transient files inherit private permissions.
  process.umask(0o077);
  const controller = new AbortController();
  const detach = attachSignals(controller);
  const argv = process.argv.slice(2);
  // Detected from raw argv so a parse failure after --json still reports JSON.
  let output = new Output(argv.includes("--json"));
  try {
    const options = argumentsFor(argv, env);
    output = new Output(options.json);
    if (options.help) {
      process.stdout.write(help);
      return;
    }
    if (options.positionals[0] === "version") {
      process.stdout.write("llame 0.0.1\n");
      return;
    }
    await new Application(options, env, output, controller.signal).execute();
  } catch (error) {
    reportFailure(cliFailure(error), output, controller.signal.aborted);
  } finally {
    detach();
  }
}

function attachSignals(controller: AbortController): () => void {
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  return () => {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  };
}

function cliFailure(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof NodeProtocolError)
    return new CliError(error.code, error.message);
  return new CliError(
    "operation_failed",
    "Operation failed. No automatic retry or mode switch was performed.",
  );
}

function reportFailure(
  failure: CliError,
  output: Output,
  aborted: boolean,
): void {
  output.event({
    eventType: "client.error",
    payload: { code: failure.code, message: failure.message },
  });
  output.notice(`${failure.code}: ${failure.message}`);
  process.exitCode = aborted ? 130 : failure.exitCode;
}

void main();
