import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { derivePromptImportTriggers } from './prompt-import-triggers';

const SPACE_ID = 'a6230f3c-4a5e-4c9b-8f0e-1d2c3b4a5e6f';
const BOTH = { host: true, knowledge: true };

describe('derivePromptImportTriggers', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'import-triggers-'));
    writeFileSync(path.join(root, 'a.md'), 'a\n');
    writeFileSync(path.join(root, 'b:1-2'), 'literal colon name\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('triggers on imported and failed entries, never on denied ones', async () => {
    const triggers = await derivePromptImportTriggers(
      [
        {
          locator: 'a',
          resolved: path.join(root, 'a.md'),
          outcome: 'imported',
        },
        { locator: 'b', resolved: '/nowhere/b.md', outcome: 'failed' },
        { locator: 'c', resolved: '/nowhere/c.md', outcome: 'denied' },
      ],
      BOTH,
    );

    expect(triggers).toEqual([
      { key: path.join(root, 'a.md') },
      { key: '/nowhere/b.md' },
    ]);
  });

  it('strips a selector only when the literal path does not exist', async () => {
    const triggers = await derivePromptImportTriggers(
      [
        {
          locator: 'a',
          resolved: `${path.join(root, 'a.md')}:1-2`,
          outcome: 'imported',
        },
        {
          locator: 'b',
          resolved: path.join(root, 'b:1-2'),
          outcome: 'imported',
        },
      ],
      BOTH,
    );

    expect(triggers).toEqual([
      { key: path.join(root, 'a.md') },
      { key: path.join(root, 'b:1-2') },
    ]);
  });

  it('names no trigger for entries without a resolved path or another scheme', async () => {
    const triggers = await derivePromptImportTriggers(
      [
        { locator: 'https://example.test/p', outcome: 'imported' },
        { locator: 'skill://pdf/SKILL.md', outcome: 'imported' },
        {
          locator: 'x',
          resolved: 'https://example.test/p',
          outcome: 'imported',
        },
      ],
      BOTH,
    );

    expect(triggers).toEqual([]);
  });

  it('resolves a kb:// entry to its Space and Space-relative key', async () => {
    const triggers = await derivePromptImportTriggers(
      [
        {
          locator: 'k',
          resolved: `kb://${SPACE_ID}/notes/a.md:10-12`,
          outcome: 'imported',
        },
        { locator: 's', resolved: `kb://${SPACE_ID}`, outcome: 'failed' },
        {
          locator: 'u',
          resolved: `kb://${SPACE_ID.toUpperCase()}/a.md`,
          outcome: 'imported',
        },
      ],
      BOTH,
    );

    expect(triggers).toEqual([
      { space: { id: SPACE_ID }, key: 'notes/a.md' },
      { space: { id: SPACE_ID }, key: '' },
    ]);
  });

  it('drops a world whose gate is closed and repeated triggers', async () => {
    const entries = [
      { locator: 'a', resolved: '/nowhere/a.md', outcome: 'imported' },
      { locator: 'a2', resolved: '/nowhere/a.md:3', outcome: 'failed' },
      {
        locator: 'k',
        resolved: `kb://${SPACE_ID}/a.md`,
        outcome: 'imported',
      },
    ] as const;

    expect(
      await derivePromptImportTriggers(entries, {
        host: true,
        knowledge: false,
      }),
    ).toEqual([{ key: '/nowhere/a.md' }]);
    expect(
      await derivePromptImportTriggers(entries, {
        host: false,
        knowledge: true,
      }),
    ).toEqual([{ space: { id: SPACE_ID }, key: 'a.md' }]);
  });
});
