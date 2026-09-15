import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import {
  bootWorkerHarness,
  createUser,
  seedAndDispatchRun,
  type WorkerHarness,
} from './worker-harness';
import { RunsRepository, RunEventsRepository } from './runs-repository';
import { waitFor } from '../testing/support';

/**
 * The reference/script workflow a skill package exists for: the model reads
 * the package, follows its relative script instruction into an absolute path,
 * and Bash runs that script with an explicit `cwd` while a task-relative input
 * argument keeps its meaning. A sibling module import proves the interpreter —
 * not llame — resolves imports relative to the script.
 */
describe('skill package references and scripts through the model loop', () => {
  let harness: WorkerHarness;
  let userId: string;
  let source: string;
  let packageDirectory: string;
  let workDirectory: string;
  const tools = ['read', 'bash'];

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL)
      throw new Error('Integration database was not provisioned.');

    source = await mkdtemp(join(tmpdir(), 'skill-acceptance-'));
    packageDirectory = join(source, 'pdf');
    await mkdir(join(packageDirectory, 'scripts'), { recursive: true });
    await mkdir(join(packageDirectory, 'references'), { recursive: true });
    await writeFile(
      join(packageDirectory, 'SKILL.md'),
      [
        '---',
        'name: pdf',
        'description: Extract text from PDF files. Use when handling PDFs.',
        '---',
        '# PDF extraction',
        '',
        'Read [the reference](references/formats.md) first.',
        '',
        'Run the extraction script from your own working directory:',
        '',
        '    ./scripts/extract.py <input>',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(packageDirectory, 'references', 'formats.md'),
      '# Formats\n\nSupported inputs are .pdf and .txt.\n',
    );
    // The script imports a sibling module, so a forced package working
    // directory would break it just as badly as a rewritten argument.
    await writeFile(
      join(packageDirectory, 'scripts', 'helper.py'),
      'def label(value):\n    return f"extracted:{value}"\n',
    );
    await writeFile(
      join(packageDirectory, 'scripts', 'extract.py'),
      [
        'import pathlib',
        'import sys',
        '',
        'from helper import label',
        '',
        '',
        'def main() -> None:',
        '    target = pathlib.Path(sys.argv[1])',
        '    print(label(target.read_text().strip()))',
        '    print(f"cwd={pathlib.Path.cwd().name}")',
        '',
        '',
        'if __name__ == "__main__":',
        '    main()',
        '',
      ].join('\n'),
    );

    harness = await bootWorkerHarness({
      allowedTools: tools,
      nativeExecutorId: 'skill-acceptance-host',
      skillDirectories: [source],
    });
    userId = await createUser(harness.db, 'skill-acceptance');
  });

  beforeEach(async () => {
    workDirectory = await mkdtemp(join(tmpdir(), 'skill-work-'));
    await writeFile(join(workDirectory, 'report.pdf'), 'payload\n');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(workDirectory, { recursive: true, force: true });
  });
  afterAll(async () => {
    if (harness) await harness.close();
    await rm(source, { recursive: true, force: true });
  });

  function terminal(runId: string) {
    return waitFor(
      async () => {
        const run = await harness.tenantDb.runAs(userId, (tx) =>
          new RunsRepository(tx).findById(runId, userId),
        );
        return run &&
          ['completed', 'failed', 'cancelled', 'expired'].includes(run.status)
          ? run
          : undefined;
      },
      30_000,
      'skill Run to settle',
    );
  }

  /** The `output` of each `tool.completed` event, keyed by tool-call id. */
  async function completedOutputs(
    runId: string,
  ): Promise<Map<string, UnknownRecord>> {
    const events = await harness.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, userId),
    );
    const byCallId = new Map<string, UnknownRecord>();
    for (const event of events) {
      if (event.eventType !== 'tool.completed') continue;
      const payload: unknown = event.payload;
      if (!isRecord(payload)) continue;
      const toolCallId = payload.toolCallId;
      const output = payload.output;
      if (isString(toolCallId) && isRecord(output)) {
        byCallId.set(toolCallId, output);
      }
    }
    return byCallId;
  }

  /** The model-facing text of one completed tool result. */
  function outputText(
    outputs: Map<string, UnknownRecord>,
    toolCallId: string,
    field: string,
  ): string {
    const output = outputs.get(toolCallId);
    if (output === undefined) throw new Error(`No result for ${toolCallId}`);
    return String(output[field]);
  }

  it('publishes package paths and lets Bash run the script unchanged', async () => {
    const modelId = `skill-read-${randomUUID()}`;
    harness.models.register(modelId, {
      kind: 'tool-script',
      finalText: 'Skill workflow finished.',
      calls: [
        { id: 'skill-root', name: 'read', input: { path: 'skill://pdf' } },
        {
          id: 'skill-resource',
          name: 'read',
          input: { path: 'skill://pdf/references/formats.md' },
        },
        {
          id: 'skill-script',
          name: 'read',
          input: { path: 'skill://pdf/scripts/extract.py' },
        },
        {
          id: 'skill-run',
          name: 'bash',
          input: {
            // The absolute script path is what the published skillDirectory is
            // for; the task-relative input stays exactly as the user gave it.
            command: `python3 ${packageDirectory}/scripts/extract.py report.pdf`,
            cwd: workDirectory,
          },
        },
      ],
    });

    const seeded = await seedAndDispatchRun(harness, {
      userId,
      modelId,
    });
    expect((await terminal(seeded.runId)).status).toBe('completed');

    const outputs = await completedOutputs(seeded.runId);

    expect(outputs.get('skill-root')).toMatchObject({
      status: 'success',
      skillDirectory: packageDirectory,
      resolvedPath: join(packageDirectory, 'SKILL.md'),
    });
    expect(outputText(outputs, 'skill-root', 'skillPathInstruction')).toContain(
      'Resolve package-relative references',
    );
    expect(outputText(outputs, 'skill-root', 'content')).toContain(
      '# PDF extraction',
    );

    expect(outputs.get('skill-resource')).toMatchObject({
      resolvedPath: join(packageDirectory, 'references', 'formats.md'),
    });
    expect(outputText(outputs, 'skill-resource', 'content')).toContain(
      'Supported inputs',
    );

    // The script arrives as source; nothing executed during the read.
    expect(outputText(outputs, 'skill-script', 'content')).toContain(
      'from helper import label',
    );

    expect(outputs.get('skill-run')).toMatchObject({ status: 'success' });
    const stdout = outputText(outputs, 'skill-run', 'stdout');
    // The interpreter resolved `from helper import label` against the script's
    // own directory; the explicit cwd is the one llame was given, and the
    // task-relative argument kept its meaning.
    expect(stdout).toContain('extracted:payload');
    expect(stdout).toContain(`cwd=${basename(workDirectory)}`);
  });
});
