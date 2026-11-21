/**
 * `machines:*` operator command logic (host-as-machine D2, spec "An operator
 * command rebinds a Machine name") — split out of `cli.ts` so this module has
 * no import-time side effect and a test can drive it directly.
 *
 * `machines:forget <name>` removes the instance id the installation bound to a
 * Machine name. The next successful handshake for that name binds whatever id
 * the daemon then reports, which is how a reinstalled or replaced computer is
 * accepted again without editing the database by hand.
 *
 * The name is validated against the configuration grammar BEFORE the database
 * is touched: a typo must fail as a usage error, not silently report that some
 * other name was never bound.
 */

import { MACHINE_NAME_PATTERN } from '../machine-locator';

/** Where a command writes: its success line, or its refusal. */
export type MachinesCommandIo = {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
};

/** Already-resolved command dependencies, so this never touches DI itself. */
export type MachinesCommandDeps = {
  /** Removes the binding and returns the instance id it held, if any. */
  forget(name: string): Promise<string | undefined>;
};

export const MACHINES_FORGET_USAGE =
  'Usage: pnpm --filter api machines:forget <name>';

/** Exit codes the shell contract pins: success, refused, usage. */
const EXIT_OK = 0;
const EXIT_NOT_BOUND = 1;
const EXIT_USAGE = 2;

/**
 * Run one `machines:*` subcommand and answer its exit code. `argv` is the
 * command and its arguments, without the script path.
 */
export async function runMachinesCommand(
  argv: ReadonlyArray<string>,
  deps: MachinesCommandDeps,
  io: MachinesCommandIo,
): Promise<number> {
  const [command, ...args] = argv;

  if (command !== 'forget') {
    io.err(MACHINES_FORGET_USAGE);

    return EXIT_USAGE;
  }

  const [name, ...extra] = args;

  if (
    extra.length > 0 ||
    name === undefined ||
    !MACHINE_NAME_PATTERN.test(name)
  ) {
    io.err(MACHINES_FORGET_USAGE);

    return EXIT_USAGE;
  }

  const instanceId = await deps.forget(name);

  if (instanceId === undefined) {
    io.err(`No instance id is bound to Machine ${name}.`);

    return EXIT_NOT_BOUND;
  }

  io.out(
    `Forgot instance id ${instanceId} of Machine ${name}; its next handshake binds a new id.`,
  );

  return EXIT_OK;
}
