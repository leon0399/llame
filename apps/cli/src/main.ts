import { Application } from './application';
import { argumentsFor, help } from './arguments';
import { environment } from '@workspace/personal-node/env';
import { CliError } from '@workspace/personal-node/errors';
import { Output } from './output';

async function main(): Promise<void> {
  const env = environment();
  // Lockfiles, SQLite journals and transient files inherit private permissions.
  process.umask(0o077);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  let output = new Output(false);
  try {
    const options = argumentsFor(process.argv.slice(2), env); output = new Output(options.json);
    if (options.help) { process.stdout.write(help); return; }
    if (options.positionals[0] === 'version') { process.stdout.write('llame 0.0.1\n'); return; }
    await new Application(options, env, output, controller.signal).execute();
  } catch (error) {
    const failure = error instanceof CliError ? error : new CliError('operation_failed', 'Operation failed. No automatic retry or mode switch was performed.');
    output.event({ eventType: 'client.error', payload: { code: failure.code, message: failure.message } });
    output.notice(`${failure.code}: ${failure.message}`);
    process.exitCode = controller.signal.aborted ? 130 : failure.exitCode;
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
}

void main();
