/**
 * The skill-catalog decision (system-provided-skills D4/D6): which baseline
 * this turn renders, what the rail discloses, and the chat-row writes the turn
 * establishes.
 *
 * The whole decision is reachable without a database — a chat row plus a
 * catalog port are its only inputs, and the caller applies whatever `freeze`
 * and `told` come back inside the completed attempt's own transaction. So these
 * cases drive it directly rather than through prompt assembly: what the worker
 * renders and writes is pinned where it happens, in
 * `run-execution.service.test.ts`.
 */

import { type Chat } from '../db/schema';
import {
  type SkillCatalogEntry,
  type SkillCatalogPort,
  type SkillCatalogSnapshot,
} from '../skills/skill-catalog';
import {
  resolveTurnSkillState,
  type SkillTurnStateDeps,
} from './skill-turn-state';

const now = new Date('2026-09-14T00:00:00.000Z');
const CHAT_ID = 'chat-id';
const USER_ID = 'user-id';
const RUN_ID = '11111111-2222-4333-8444-555555555555';
const SOURCE = '/srv/skills';

const entry = (
  name: string,
  description: string | null = `${name} description`,
  overrides: Partial<SkillCatalogEntry> = {},
): SkillCatalogEntry => ({
  name,
  description,
  proactive: true,
  sourceDirectory: SOURCE,
  skillDirectory: `${SOURCE}/${name}`,
  available: true,
  diagnostics: [],
  ...overrides,
});

const chat = (overrides: Partial<Chat> = {}): Chat => ({
  id: CHAT_ID,
  ownerUserId: USER_ID,
  title: null,
  visibility: 'private',
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  projectId: null,
  recencyDigestBaseline: null,
  recencyDigestTold: null,
  recencyDigestRebakedFrom: null,
  skillCatalogBaseline: null,
  skillCatalogRebakedFrom: null,
  skillCatalogTold: null,
  ...overrides,
});

const snapshot = (overrides: Partial<SkillCatalogSnapshot> = {}) => ({
  available: true,
  directories: [SOURCE],
  entries: [] as ReadonlyArray<SkillCatalogEntry>,
  diagnostics: [] as ReadonlyArray<string>,
  ...overrides,
});

const deps = (
  overrides: Partial<SkillTurnStateDeps> = {},
): SkillTurnStateDeps => ({
  skillCatalog: { getSnapshot: () => snapshot() },
  skillDirectories: [SOURCE],
  ...overrides,
});

const resolve = (
  state: SkillTurnStateDeps,
  row: Chat,
  options: {
    readonly latestCompactionId?: string | null;
    readonly modelReferencesSkills?: boolean;
  } = {},
) =>
  resolveTurnSkillState(state, {
    chat: row,
    runId: RUN_ID,
    latestCompactionId: options.latestCompactionId ?? null,
    modelReferencesSkills: options.modelReferencesSkills ?? true,
  });

describe('an unreadable catalog mid-epoch', () => {
  it('reports every diagnostic with its configured source path redacted', () => {
    const reported: Array<ReadonlyArray<string>> = [];

    resolve(
      {
        skillCatalog: {
          getSnapshot: () =>
            snapshot({
              available: false,
              diagnostics: [
                '/srv/skills is not readable',
                '/srv/skills/extra/pdf has no SKILL.md',
              ],
            }),
        },
        skillDirectories: ['/srv/skills', '/srv/skills/extra'],
        reportUnavailable: (diagnostics) => reported.push(diagnostics),
      },
      chat({
        skillCatalogBaseline: { entries: [], omitted: 0 },
        skillCatalogTold: [],
      }),
    );

    // Joined with a space, so two reasons stay two sentences rather than
    // running together, and no absolute path survives either replacement.
    expect(reported).toEqual([
      ['<skill source> is not readable <skill source>/pdf has no SKILL.md'],
    ]);
  });

  it('replaces a nested source whole instead of leaving its parent behind', () => {
    const reported: Array<ReadonlyArray<string>> = [];

    resolve(
      {
        skillCatalog: {
          getSnapshot: () =>
            snapshot({ available: false, diagnostics: ['/srv/a/b failed'] }),
        },
        // Shortest first on purpose: replacing '/srv/a' before '/srv/a/b'
        // would leave '<skill source>/b failed'.
        skillDirectories: ['/srv/a', '/srv/a/b'],
        reportUnavailable: (diagnostics) => reported.push(diagnostics),
      },
      chat({
        skillCatalogBaseline: { entries: [], omitted: 0 },
        skillCatalogTold: [],
      }),
    );

    expect(reported).toEqual([['<skill source> failed']]);
  });

  it('leaves the reason alone when a configured source is the empty string', () => {
    const reported: Array<ReadonlyArray<string>> = [];

    resolve(
      {
        skillCatalog: {
          getSnapshot: () =>
            snapshot({ available: false, diagnostics: ['no source'] }),
        },
        // `replaceAll('')` splices the placeholder between every character, so
        // an empty entry must be skipped rather than applied.
        skillDirectories: [''],
        reportUnavailable: (diagnostics) => reported.push(diagnostics),
      },
      chat({
        skillCatalogBaseline: { entries: [], omitted: 0 },
        skillCatalogTold: [],
      }),
    );

    expect(reported).toEqual([['no source']]);
  });

  it('emits no notice, so the epoch is not told about removals that did not happen', () => {
    const state = resolve(
      deps({
        skillCatalog: {
          getSnapshot: () =>
            snapshot({ available: false, diagnostics: ['unreadable'] }),
        },
      }),
      chat({
        skillCatalogBaseline: { entries: [], omitted: 0 },
        skillCatalogTold: ['research'],
      }),
    );

    expect(state.notice).toBeUndefined();
    expect(state.told).toBeUndefined();
    expect(state.freeze).toBeUndefined();
    // The stored baseline still renders for the rest of the epoch.
    expect(state.baseline).toEqual({ entries: [], omitted: 0 });
  });

  it('reports and renders nothing when the catalog is unreadable at epoch start', () => {
    const reported: Array<ReadonlyArray<string>> = [];

    const state = resolve(
      {
        skillCatalog: {
          getSnapshot: () =>
            snapshot({
              available: false,
              diagnostics: [
                `Skill source ${SOURCE} is missing or unreadable; the catalog is unavailable.`,
              ],
            }),
        },
        skillDirectories: [SOURCE],
        reportUnavailable: (diagnostics) => reported.push(diagnostics),
      },
      chat(),
    );

    // No section, no baseline to freeze, and no told state — resolving one would
    // fail the turn outright on the missing entries.
    expect(state.baseline).toBeUndefined();
    expect(state.freeze).toBeUndefined();
    expect(state.told).toBeUndefined();
    expect(state.notice).toBeUndefined();
    // The reason survives; the configured host path does not.
    expect(reported).toEqual([
      [
        'Skill source <skill source> is missing or unreadable; the catalog is unavailable.',
      ],
    ]);
  });
});

describe('a delta too large to render', () => {
  it('supersedes with a snapshot of the current set, not an empty one', () => {
    // The baseline carries the same entry and byte bounds the delta is checked
    // against, so additions alone always fit. Only additions plus removals can
    // exceed it: a chat told about a source that is gone, now offered another.
    const entries = Array.from({ length: 100 }, (_, index) =>
      entry(`skill-${index}`),
    );
    const told = Array.from({ length: 200 }, (_, index) => `gone-${index}`);

    const state = resolve(
      deps({
        skillCatalog: { getSnapshot: () => snapshot({ entries }) },
      }),
      chat({
        skillCatalogBaseline: { entries: [...entries], omitted: 0 },
        skillCatalogTold: told,
      }),
    );

    const body = state.notice?.item.data.text ?? '';
    expect(body).toContain('Earlier skill catalog updates');
    expect(body).toContain('- `skill-0`: skill-0 description');
    expect(body).not.toContain('No skills are currently available');
    expect(state.told).toContain('skill-0');
  });
});

describe('the frozen skill-catalog baseline', () => {
  it('resolves nothing when no skill source is configured', () => {
    const state = resolve(
      deps({ skillCatalog: undefined, skillDirectories: [] }),
      chat(),
    );

    // No key at all, which is what leaves the default template's
    // `{{#if skills}}` section unrendered.
    expect(state.baseline).toBeUndefined();
    expect(state.freeze).toBeUndefined();
    expect(state.told).toBeUndefined();
  });

  it('resolves the current catalog and freezes it on the chat', () => {
    const state = resolve(
      deps({
        skillCatalog: {
          getSnapshot: () =>
            snapshot({
              entries: [
                entry('pdf', 'Extract text'),
                entry('review', 'Review', { proactive: false }),
                entry('broken', null, { available: false }),
              ],
            }),
        },
      }),
      chat(),
    );

    // Only the proactively eligible, readable package reaches the projection.
    expect(state.baseline).toEqual({
      entries: [{ name: 'pdf', description: 'Extract text' }],
      omitted: 0,
    });
    expect(state.freeze).toEqual({
      baseline: {
        entries: [{ name: 'pdf', description: 'Extract text' }],
        omitted: 0,
      },
      rebakedFrom: null,
    });
    expect(state.told).toEqual(['pdf']);
  });

  it('passes an empty baseline through when the catalog admits nothing', () => {
    const state = resolve(
      deps({
        skillCatalog: {
          getSnapshot: () =>
            snapshot({
              entries: [entry('review', 'Review', { proactive: false })],
            }),
        },
      }),
      chat(),
    );

    // The projection is present but empty: the gate on rendering the section at
    // all is one layer deeper, in the prompt loader's `skillsContext`, where
    // zero entries makes `skills` absent from the Handlebars context.
    expect(state.baseline).toEqual({ entries: [], omitted: 0 });
    expect(state.freeze).toEqual({
      baseline: { entries: [], omitted: 0 },
      rebakedFrom: null,
    });
    expect(state.told).toEqual([]);
  });

  it('reuses a stored baseline within the same compaction epoch', () => {
    const stored = {
      entries: [{ name: 'stored', description: 'From the baseline' }],
      omitted: 2,
    };

    const state = resolve(
      // The catalog would resolve differently, so a live read would be visible.
      deps({
        skillCatalog: {
          getSnapshot: () => snapshot({ entries: [entry('pdf', 'Fresh')] }),
        },
      }),
      chat({
        skillCatalogBaseline: stored,
        skillCatalogRebakedFrom: 'compaction-1',
      }),
      { latestCompactionId: 'compaction-1' },
    );

    expect(state.baseline).toEqual(stored);
    expect(state.freeze).toBeUndefined();
  });

  it('re-resolves at the turn after a new compaction starts an epoch', () => {
    const state = resolve(
      deps({
        skillCatalog: {
          getSnapshot: () => snapshot({ entries: [entry('pdf', 'Fresh')] }),
        },
      }),
      chat({
        skillCatalogBaseline: {
          entries: [{ name: 'stale', description: 'Old epoch' }],
          omitted: 0,
        },
        skillCatalogRebakedFrom: 'compaction-1',
      }),
      { latestCompactionId: 'compaction-2' },
    );

    expect(state.freeze).toEqual({
      baseline: {
        entries: [{ name: 'pdf', description: 'Fresh' }],
        omitted: 0,
      },
      rebakedFrom: 'compaction-2',
    });
  });

  it('keeps an uncompacted chat on its first baseline', () => {
    const stored = {
      entries: [{ name: 'stored', description: 'd' }],
      omitted: 0,
    };

    const state = resolve(
      deps({
        skillCatalog: {
          getSnapshot: () => snapshot({ entries: [entry('pdf', 'Fresh')] }),
        },
      }),
      chat({
        skillCatalogBaseline: stored,
        skillCatalogRebakedFrom: null,
        skillCatalogTold: null,
      }),
    );

    expect(state.baseline).toEqual(stored);
    expect(state.freeze).toBeUndefined();
  });

  it('keeps advertising a stored baseline after the source list is emptied', () => {
    const stored = {
      entries: [{ name: 'stored', description: 'From the baseline' }],
      omitted: 0,
    };

    const state = resolve(
      // No configured source now, but the chat holds a baseline for this epoch.
      deps({ skillCatalog: undefined, skillDirectories: [] }),
      chat({
        skillCatalogBaseline: stored,
        skillCatalogRebakedFrom: null,
        skillCatalogTold: null,
      }),
    );

    // Reuse outranks the configured list: dropping the section here would
    // silently unadvertise a catalog the chat is still told about, and removals
    // are announced as notices rather than by mutating the frozen prompt.
    expect(state.baseline).toEqual(stored);
    expect(state.freeze).toBeUndefined();
  });

  it('resolves nothing for an unconfigured instance with no stored baseline', () => {
    const state = resolve(
      deps({ skillCatalog: undefined, skillDirectories: [] }),
      chat(),
    );

    expect(state.baseline).toBeUndefined();
    expect(state.freeze).toBeUndefined();
  });

  it('reports an honest omitted count when the bound overflows', () => {
    const entries = Array.from({ length: 300 }, (_, index) =>
      entry(`s${String(index).padStart(3, '0')}`, 'd'),
    );

    const state = resolve(
      deps({
        skillCatalog: { getSnapshot: () => snapshot({ entries }) },
      }),
      chat(),
    );

    expect(state.baseline?.entries).toHaveLength(256);
    expect(state.baseline?.omitted).toBe(44);
  });
});

describe('the skill-catalog notice', () => {
  it('announces an addition with its current description', () => {
    const state = resolve(
      deps({
        skillCatalog: {
          getSnapshot: () =>
            snapshot({
              entries: [
                entry('pdf', 'Extract text'),
                entry('research', 'Plan it'),
              ],
            }),
        },
      }),
      chat({
        skillCatalogBaseline: {
          entries: [{ name: 'pdf', description: 'Extract text' }],
          omitted: 0,
        },
        skillCatalogRebakedFrom: null,
        skillCatalogTold: ['pdf'],
      }),
    );

    const { text, payload } = state.notice!.item.data;
    expect(text).toContain('`research`');
    expect(text).toContain('Plan it');
    expect(payload).toMatchObject({
      kind: 'delta',
      added: [{ name: 'research', description: 'Plan it' }],
      removed: [],
    });
    // The turn reports the told state it establishes; persisting it belongs to
    // the completed attempt's transaction, so this unit asserts the value
    // rather than the write.
    expect(state.told).toEqual(['pdf', 'research']);
  });

  it('announces a removal by name only', () => {
    const state = resolve(
      deps({
        skillCatalog: {
          getSnapshot: () => snapshot({ entries: [entry('pdf', 'Extract text')] }),
        },
      }),
      chat({
        skillCatalogBaseline: { entries: [], omitted: 0 },
        skillCatalogRebakedFrom: null,
        skillCatalogTold: ['pdf', 'legacy'],
      }),
    );

    const { text, payload } = state.notice!.item.data;
    expect(payload).toMatchObject({
      kind: 'delta',
      added: [],
      removed: ['legacy'],
    });
    // A removals-only delta carries no operator text, so no precedence line.
    expect(text).not.toContain('operator-authored catalog data');
  });

  it('emits nothing when the advertised set is unchanged', () => {
    const state = resolve(
      deps({
        skillCatalog: {
          getSnapshot: () => snapshot({ entries: [entry('pdf', 'Extract text')] }),
        },
      }),
      chat({
        skillCatalogBaseline: {
          entries: [{ name: 'pdf', description: 'Extract text' }],
          omitted: 0,
        },
        skillCatalogRebakedFrom: null,
        skillCatalogTold: ['pdf'],
      }),
    );

    expect(state.notice).toBeUndefined();
    expect(state.told).toBeUndefined();
  });

  it('emits nothing and leaves the told state alone on an opted-out model', () => {
    const state = resolve(
      deps({
        skillCatalog: {
          getSnapshot: () =>
            snapshot({
              entries: [
                entry('pdf', 'Extract text'),
                entry('research', 'Plan it'),
              ],
            }),
        },
      }),
      chat({
        skillCatalogBaseline: { entries: [], omitted: 0 },
        skillCatalogRebakedFrom: null,
        skillCatalogTold: ['pdf'],
      }),
      { modelReferencesSkills: false },
    );

    expect(state.notice).toBeUndefined();
    // Untouched, so a later switch to a rendering model announces the addition.
    expect(state.told).toBeUndefined();
  });

  it('announces the addition after a switch to a rendering model', () => {
    const state = resolve(
      deps({
        skillCatalog: {
          getSnapshot: () =>
            snapshot({
              entries: [
                entry('pdf', 'Extract text'),
                entry('research', 'Plan it'),
              ],
            }),
        },
      }),
      chat({
        skillCatalogBaseline: { entries: [], omitted: 0 },
        skillCatalogRebakedFrom: null,
        skillCatalogTold: ['pdf'],
      }),
      { modelReferencesSkills: true },
    );

    expect(state.notice?.item.data.payload).toMatchObject({
      added: [expect.objectContaining({ name: 'research' })],
    });
  });

  it('starts a new told state at a compaction epoch with no notice', () => {
    const state = resolve(
      deps({
        skillCatalog: {
          getSnapshot: () => snapshot({ entries: [entry('pdf', 'Extract text')] }),
        },
      }),
      chat({
        skillCatalogBaseline: {
          entries: [{ name: 'stale', description: 'Old epoch' }],
          omitted: 0,
        },
        skillCatalogRebakedFrom: 'compaction-1',
        skillCatalogTold: ['stale'],
      }),
      { latestCompactionId: 'compaction-2' },
    );

    // No delta across the boundary: the baseline is what the model is shown.
    expect(state.notice).toBeUndefined();
    // The epoch reset states the told set directly rather than as a notice.
    expect(state.freeze).toEqual({
      baseline: {
        entries: [{ name: 'pdf', description: 'Extract text' }],
        omitted: 0,
      },
      rebakedFrom: 'compaction-2',
    });
    expect(state.told).toEqual(['pdf']);
  });

  it('adopts the baseline as told state when none was recorded', () => {
    // A chat whose baseline predates this layer was still shown the catalog by
    // its prompt, so adopting it emits no duplicate notice.
    const stored = {
      entries: [{ name: 'pdf', description: 'Extract text' }],
      omitted: 0,
    };

    const state = resolve(
      deps({
        skillCatalog: {
          getSnapshot: () => snapshot({ entries: [entry('pdf', 'Extract text')] }),
        },
      }),
      chat({
        skillCatalogBaseline: stored,
        skillCatalogRebakedFrom: null,
        skillCatalogTold: null,
      }),
    );

    expect(state.notice).toBeUndefined();
    expect(state.told).toBeUndefined();
  });

  it('announces the removals when no catalog port reaches the turn at all', () => {
    // Not the production shape — `SkillsModule` always provides a port — but
    // the branch exists because a turn assembled without one must not diff
    // against nothing and silently unadvertise a catalog the chat still shows.
    const state = resolve(
      deps({ skillCatalog: undefined, skillDirectories: [] }),
      chat({
        skillCatalogBaseline: {
          entries: [{ name: 'pdf', description: 'Extract' }],
          omitted: 0,
        },
        skillCatalogRebakedFrom: null,
        skillCatalogTold: ['pdf'],
      }),
    );

    expect(state.notice?.item.data.payload).toMatchObject({
      kind: 'delta',
      added: [],
      removed: ['pdf'],
    });
    expect(state.told).toEqual([]);
  });

  it('announces the removals when the source list is emptied mid-epoch', () => {
    // The operator disables skills by emptying `skills.directories` after this
    // chat froze a baseline. The stored baseline stays in the prompt for the
    // rest of the epoch, so the removals MUST be announced — suppressing the
    // delta would leave the model attempting stale reads with no notice.
    //
    // This is the production shape: `SkillsModule` builds a `SkillCatalog`
    // unconditionally, so an emptied list still yields a port whose snapshot
    // is available and empty. The absent-port case is separate, above.
    const state = resolve(
      deps({ skillCatalog: { getSnapshot: () => snapshot() } }),
      chat({
        skillCatalogBaseline: {
          entries: [
            { name: 'pdf', description: 'Extract' },
            { name: 'research', description: 'Plan' },
          ],
          omitted: 0,
        },
        skillCatalogRebakedFrom: null,
        skillCatalogTold: ['pdf', 'research'],
      }),
    );

    expect(state.notice?.item.data.payload).toMatchObject({
      kind: 'delta',
      added: [],
      removed: ['pdf', 'research'],
    });
    expect(state.told).toEqual([]);
  });

  it('supersedes with a snapshot when the delta cannot fit the bound', () => {
    // 300 removals plus one addition is past the 256-entry bound, so the delta
    // cannot be rendered honestly and the bounded current set replaces it.
    const told = Array.from({ length: 300 }, (_, index) =>
      `gone-${String(index).padStart(3, '0')}`,
    );

    const state = resolve(
      deps({
        skillCatalog: {
          getSnapshot: () => snapshot({ entries: [entry('pdf', 'Extract text')] }),
        },
      }),
      chat({
        skillCatalogBaseline: { entries: [], omitted: 0 },
        skillCatalogRebakedFrom: null,
        skillCatalogTold: told,
      }),
    );

    const { form, text, payload } = state.notice!.item.data;
    expect(form).toBe('snapshot');
    expect(text).toContain('superseded');
    expect(payload).toMatchObject({ kind: 'snapshot', omitted: 0 });
    // The told state becomes the snapshot's admitted set, not the delta's.
    expect(state.told).toEqual(['pdf']);
  });

  it('supersedes when the delta exceeds the byte bound', () => {
    // Names come out of the told state and are not themselves bounded, so a
    // large told set alongside a large advertised entry overflows on bytes.
    const told = Array.from(
      { length: 200 },
      (_, index) => `${'g'.repeat(60)}-${index}`,
    );

    const state = resolve(
      deps({
        skillCatalog: {
          getSnapshot: () =>
            snapshot({ entries: [entry('pdf', 'x'.repeat(15 * 1024))] }),
        },
      }),
      chat({
        skillCatalogBaseline: { entries: [], omitted: 0 },
        skillCatalogRebakedFrom: null,
        skillCatalogTold: told,
      }),
    );

    expect(state.notice?.item.data.form).toBe('snapshot');
  });
});
