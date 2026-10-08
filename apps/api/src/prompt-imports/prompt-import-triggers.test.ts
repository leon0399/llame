import { describe, expect, it } from 'vitest';

import { derivePromptImportTriggers } from './prompt-import-triggers';

const SPACE_ID = 'a6230f3c-4a5e-4c9b-8f0e-1d2c3b4a5e6f';
const BOTH = { host: true, knowledge: true };

describe('derivePromptImportTriggers', () => {
  it('triggers on imported and failed entries, never on denied ones', () => {
    const triggers = derivePromptImportTriggers(
      [
        { locator: 'a', resolved: '/r/a.md', outcome: 'imported' },
        { locator: 'b', resolved: '/nowhere/b.md', outcome: 'failed' },
        { locator: 'c', resolved: '/nowhere/c.md', outcome: 'denied' },
      ],
      BOTH,
    );

    expect(triggers).toEqual([{ key: '/r/a.md' }, { key: '/nowhere/b.md' }]);
  });

  it('keeps a colon-named file literal and normalizes the path', () => {
    const triggers = derivePromptImportTriggers(
      [
        { locator: 'a', resolved: '/r/notes:2', outcome: 'imported' },
        { locator: 'b', resolved: '/r/x/../b:1-2', outcome: 'imported' },
      ],
      BOTH,
    );

    expect(triggers).toEqual([{ key: '/r/notes:2' }, { key: '/r/b:1-2' }]);
  });

  it('names no trigger for entries without a resolved path or another scheme', () => {
    const triggers = derivePromptImportTriggers(
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

  it('does not trigger on an uppercase Space id in a persisted kb:// entry', () => {
    const triggers = derivePromptImportTriggers(
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

  it('drops a world whose gate is closed', () => {
    const entries = [
      { locator: 'a', resolved: '/nowhere/a.md', outcome: 'imported' },
      {
        locator: 'k',
        resolved: `kb://${SPACE_ID}/a.md`,
        outcome: 'imported',
      },
    ] as const;

    expect(
      derivePromptImportTriggers(entries, { host: true, knowledge: false }),
    ).toEqual([{ key: '/nowhere/a.md' }]);
    expect(
      derivePromptImportTriggers(entries, { host: false, knowledge: true }),
    ).toEqual([{ space: { id: SPACE_ID }, key: 'a.md' }]);
  });
});
