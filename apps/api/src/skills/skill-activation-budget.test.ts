import {
  createSkillActivationOmissionItem,
  MAX_OMISSION_IMPORT_LOCATOR_LENGTH,
  MAX_OMISSION_IMPORT_NAMES,
} from '../chats/skill-activation-item';
import { measureNativeModelOutput } from '@workspace/native-file-tools';
import { activateSkills, MAX_SKILL_ACTIVATION_BYTES } from './skill-activation';
import { parseSkillMentions } from './skill-mention';
import {
  auditedContext,
  fileResult,
  notFoundResult,
  rootResult,
  scriptedReadTool,
  STUB_RUN_ID,
} from './skill-read.stub';

/** A read result stays under the shared 16 KB cap, so fill with many files. */
const FULL_FILE = 15_000;
const FILLER_FILES = 8;
const PROBE_LENGTH = 100;

/**
 * The bytes instructions may spend for these mentions: the aggregate bound less
 * the largest omission notice they could need.
 */
function instructionCeiling(names: ReadonlyArray<string>): number {
  const notice = createSkillActivationOmissionItem({
    runId: STUB_RUN_ID,
    skills: names,
    imports: Array.from({ length: MAX_OMISSION_IMPORT_NAMES + 1 }, () =>
      'x'.repeat(MAX_OMISSION_IMPORT_LOCATOR_LENGTH + 1),
    ),
  });
  return MAX_SKILL_ACTIVATION_BYTES - measureNativeModelOutput(notice);
}

/**
 * `first` imports eight full files and one tunable file; `second` has no
 * imports. The tunable file's length moves the activation's size one byte per
 * character.
 */
async function activate(mentions: ReadonlyArray<string>, tunedLength: number) {
  const fileNames = [
    ...Array.from({ length: FILLER_FILES }, (_, index) => `f${index}.md`),
    'tuned.md',
  ];
  const h = auditedContext();
  const outcome = await activateSkills({
    mentions: parseSkillMentions(mentions.map((name) => `$${name}`).join(' ')),
    runId: STUB_RUN_ID,
    readTool: scriptedReadTool((path) => {
      if (path === 'skill://first:raw') {
        return rootResult(
          'first',
          fileNames.map((name) => `@${name}`).join(' '),
        );
      }
      if (path === 'skill://second:raw') return rootResult('second', 'Second.');
      if (path === 'skill://first/tuned.md:raw') {
        return fileResult('a'.repeat(tunedLength));
      }
      return path.startsWith('skill://first/f')
        ? fileResult('a'.repeat(FULL_FILE))
        : notFoundResult();
    }),
    toolContext: h.context,
    callTimeoutSeconds: 5,
    activity: h.activity,
  });
  return outcome;
}

function bytesOf(items: ReadonlyArray<object>): number {
  return items.reduce<number>(
    (sum, item) => sum + measureNativeModelOutput(item),
    0,
  );
}

/** The tuned length at which everything `first` and `second` carry fills the ceiling exactly. */
async function exactFit(mentions: ReadonlyArray<string>): Promise<number> {
  const probe = await activate(mentions, PROBE_LENGTH);
  const loaded = probe.items.filter(
    (item) => item.data.payload['kind'] === 'activation',
  );
  expect(loaded).toHaveLength(mentions.length);
  const length = PROBE_LENGTH + instructionCeiling(mentions) - bytesOf(loaded);
  expect(length).toBeGreaterThan(0);
  expect(length).toBeLessThanOrEqual(FULL_FILE);
  return length;
}

describe('activation byte budget', () => {
  it('loads a selection whose item ends exactly at the ceiling', async () => {
    const mentions = ['first', 'second'];
    const length = await exactFit(mentions);

    const outcome = await activate(mentions, length);

    expect(outcome.items.map((item) => item.data.payload['kind'])).toEqual([
      'activation',
      'activation',
    ]);
    expect(bytesOf(outcome.items)).toBe(instructionCeiling(mentions));
  });

  it('names a selection that would carry the total past the ceiling', async () => {
    const mentions = ['first', 'second'];
    const length = await exactFit(mentions);

    const outcome = await activate(mentions, length + 1);

    expect(outcome.items.map((item) => item.data.payload['kind'])).toEqual([
      'activation',
      'omission',
    ]);
    expect(outcome.items[1].data.payload).toMatchObject({ skills: ['second'] });
  });

  it('keeps an import that ends the activation exactly at the ceiling', async () => {
    const mentions = ['first'];
    const length = await exactFit(mentions);

    const outcome = await activate(mentions, length);

    expect(outcome.items).toHaveLength(1);
    expect(outcome.items[0].data.payload['imports']).toHaveLength(
      FILLER_FILES + 1,
    );
    expect(bytesOf(outcome.items)).toBe(instructionCeiling(mentions));
  });

  it('names an import that would carry the activation past the ceiling', async () => {
    const mentions = ['first'];
    const length = await exactFit(mentions);

    const outcome = await activate(mentions, length + 1);

    expect(outcome.items[0].data.payload['imports']).toHaveLength(FILLER_FILES);
    expect(outcome.items[1].data.payload).toMatchObject({
      kind: 'omission',
      imports: ['skill://first/tuned.md'],
    });
  });
});
