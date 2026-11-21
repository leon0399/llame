/**
 * `machines:*` operator commands (host-as-machine D2) — the process shell:
 * argv, the Nest application context's lifecycle, and the exit code. Follows
 * `db:migrate`'s and `search/operations/cli.ts`'s shape: a `tsx` entrypoint
 * resolved as a `package.json` script, with the Nest context built from a
 * narrow module (`OperationsModule`, see its own doc comment).
 *
 * It runs as soon as it is imported, with no `require.main` guard, so it must
 * never be imported from a test. Everything worth testing directly lives in
 * `cli-commands.ts`, which has no import-time side effect.
 *
 * Usage: `npx tsx src/machines/operations/cli.ts forget <name>`
 * (wired as `pnpm --filter api machines:forget <name>`).
 */
import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';

import { MachineBindingsRepository } from '../machine-bindings.repository';
import { runMachinesCommand } from './cli-commands';
import { OperationsModule } from './operations.module';

config({ path: '.env.local' });

async function main(): Promise<number> {
  const app = await NestFactory.createApplicationContext(OperationsModule);

  try {
    const bindings = app.get(MachineBindingsRepository);

    return await runMachinesCommand(
      process.argv.slice(2),
      { forget: (name) => bindings.forget(name) },
      {
        out: (line) => console.log(line),
        err: (line) => console.error(line),
      },
    );
  } finally {
    // Log-and-swallow, as the search CLI does: a close-time error must never
    // overturn a command that already printed its own answer.
    await app.close().catch((error: unknown) => {
      console.error(
        'Warning: error while closing the application context',
        error,
      );
    });
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('❌ machines:forget failed');
    console.error(error);
    process.exit(1);
  });
