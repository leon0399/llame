/**
 * `runMachinesCommand` — the `machines:forget` shell contract, without a
 * process: the exit code, the line each outcome prints, and the fact that a
 * bad name never reaches the database. The repository's own statements are
 * pinned by `machine-bindings.repository.test.ts`; the RLS split by the
 * integration suite.
 */

import {
  MACHINES_FORGET_USAGE,
  runMachinesCommand,
  type MachinesCommandIo,
} from './cli-commands';

const NAME = 'devl';
const INSTANCE_ID = '00000000-0000-4000-8000-000000000001';

function capture() {
  const out: Array<string> = [];
  const err: Array<string> = [];

  const io: MachinesCommandIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };

  return { io, out, err };
}

describe('runMachinesCommand', () => {
  it('prints the id it removed and exits 0', async () => {
    const forget = vi.fn(() => Promise.resolve(INSTANCE_ID));
    const { io, out, err } = capture();

    await expect(
      runMachinesCommand(['forget', NAME], { forget }, io),
    ).resolves.toBe(0);

    expect(forget).toHaveBeenCalledWith(NAME);
    expect(out).toEqual([
      `Forgot instance id ${INSTANCE_ID} of Machine ${NAME}; its next handshake binds a new id.`,
    ]);
    expect(err).toEqual([]);
  });

  it('reports an unbound name on stderr and exits 1', async () => {
    const forget = vi.fn(() => Promise.resolve(undefined));
    const { io, out, err } = capture();

    await expect(
      runMachinesCommand(['forget', NAME], { forget }, io),
    ).resolves.toBe(1);

    expect(out).toEqual([]);
    expect(err).toEqual([`No instance id is bound to Machine ${NAME}.`]);
  });

  const USAGE_ARGVS: ReadonlyArray<[string, ReadonlyArray<string>]> = [
    ['an uppercase name', ['forget', 'Devl']],
    ['an empty name', ['forget', '']],
    ['a name with a space', ['forget', 'a b']],
    ['a name with punctuation', ['forget', 'devl!']],
    ['a name past the bound', ['forget', 'x'.repeat(64)]],
    ['a missing name', ['forget']],
    ['extra arguments', ['forget', NAME, 'other']],
    ['no subcommand', []],
    ['an empty subcommand', ['']],
    ['an unknown subcommand', ['rebind']],
  ];

  it.each(USAGE_ARGVS)(
    'refuses %s as a usage error without touching the database',
    async (_label, argv) => {
      const forget = vi.fn(() => Promise.resolve(INSTANCE_ID));
      const { io, out, err } = capture();

      await expect(runMachinesCommand(argv, { forget }, io)).resolves.toBe(2);

      expect(forget).not.toHaveBeenCalled();
      expect(out).toEqual([]);
      expect(err).toEqual([MACHINES_FORGET_USAGE]);
    },
  );
});
