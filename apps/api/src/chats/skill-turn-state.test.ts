/**
 * Two behaviors of a continuing epoch that no integration test observes: what
 * the operator channel is told when the catalog stops being readable, and what
 * a superseding snapshot lists when the delta cannot be rendered.
 *
 * Both are reachable without a database: a chat carrying a baseline for the
 * current epoch resolves from the stored row alone.
 */

import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Chat } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  type SkillCatalogEntry,
  type SkillCatalogPort,
  type SkillCatalogSnapshot,
} from '../skills/skill-catalog';
import { resolveTurnSkillState } from './skill-turn-state';

const now = new Date('2026-09-14T00:00:00.000Z');
const RUN_ID = '11111111-2222-4333-8444-555555555555';

const entry = (name: string): SkillCatalogEntry => ({
  name,
  description: `${name} description`,
  proactive: true,
  sourceDirectory: '/srv/skills',
  skillDirectory: `/srv/skills/${name}`,
  available: true,
  diagnostics: [],
});

const chatTold = (told: ReadonlyArray<string>): Chat => ({
  id: 'chat-id',
  ownerUserId: 'user-id',
  title: null,
  visibility: 'private',
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  projectId: null,
  recencyDigestBaseline: null,
  recencyDigestTold: null,
  recencyDigestRebakedFrom: null,
  skillCatalogBaseline: { entries: [], omitted: 0 },
  skillCatalogRebakedFrom: null,
  skillCatalogTold: [...told],
});

const port = (snapshot: Partial<SkillCatalogSnapshot>): SkillCatalogPort => ({
  getSnapshot: () => ({
    available: true,
    directories: [],
    entries: [],
    diagnostics: [],
    ...snapshot,
  }),
});

// The stored baseline matches the epoch, so this branch never queries; a mock
// connection would fail loudly if it did.
const tx: Db = drizzle.mock({ schema });

const resolve = async (
  deps: Parameters<typeof resolveTurnSkillState>[0],
  chat: Chat,
) =>
  resolveTurnSkillState(deps, {
    tx,
    chat,
    chatId: chat.id,
    ownerUserId: chat.ownerUserId,
    runId: RUN_ID,
    latestCompactionId: null,
    modelReferencesSkills: true,
  });

describe('an unreadable catalog mid-epoch', () => {
  it('reports every diagnostic with its configured source path redacted', async () => {
    const reported: Array<ReadonlyArray<string>> = [];

    await resolve(
      {
        skillCatalog: port({
          available: false,
          diagnostics: [
            '/srv/skills is not readable',
            '/srv/skills/extra/pdf has no SKILL.md',
          ],
        }),
        skillDirectories: ['/srv/skills', '/srv/skills/extra'],
        reportUnavailable: (diagnostics) => reported.push(diagnostics),
      },
      chatTold([]),
    );

    // Joined with a space, so two reasons stay two sentences rather than
    // running together, and no absolute path survives either replacement.
    expect(reported).toEqual([
      ['<skill source> is not readable <skill source>/pdf has no SKILL.md'],
    ]);
  });

  it('replaces a nested source whole instead of leaving its parent behind', async () => {
    const reported: Array<ReadonlyArray<string>> = [];

    await resolve(
      {
        skillCatalog: port({
          available: false,
          diagnostics: ['/srv/a/b failed'],
        }),
        // Shortest first on purpose: replacing '/srv/a' before '/srv/a/b'
        // would leave '<skill source>/b failed'.
        skillDirectories: ['/srv/a', '/srv/a/b'],
        reportUnavailable: (diagnostics) => reported.push(diagnostics),
      },
      chatTold([]),
    );

    expect(reported).toEqual([['<skill source> failed']]);
  });

  it('leaves the reason alone when a configured source is the empty string', async () => {
    const reported: Array<ReadonlyArray<string>> = [];

    await resolve(
      {
        skillCatalog: port({ available: false, diagnostics: ['no source'] }),
        // `replaceAll('')` splices the placeholder between every character, so
        // an empty entry must be skipped rather than applied.
        skillDirectories: [''],
        reportUnavailable: (diagnostics) => reported.push(diagnostics),
      },
      chatTold([]),
    );

    expect(reported).toEqual([['no source']]);
  });

  it('emits no notice, so the epoch is not told about removals that did not happen', async () => {
    const state = await resolve(
      {
        skillCatalog: port({ available: false, diagnostics: ['unreadable'] }),
        skillDirectories: ['/srv/skills'],
      },
      chatTold(['research']),
    );

    expect(state.notice).toBeUndefined();
  });
});

describe('a delta too large to render', () => {
  it('supersedes with a snapshot of the current set, not an empty one', async () => {
    // The baseline carries the same entry and byte bounds the delta is checked
    // against, so additions alone always fit. Only additions plus removals can
    // exceed it: a chat told about a source that is gone, now offered another.
    const entries = Array.from({ length: 100 }, (_, index) =>
      entry(`skill-${index}`),
    );
    const told = Array.from({ length: 200 }, (_, index) => `gone-${index}`);

    const state = await resolve(
      {
        skillCatalog: port({ entries }),
        skillDirectories: ['/srv/skills'],
      },
      chatTold(told),
    );

    const body = state.notice?.item.data.text ?? '';
    expect(body).toContain('Earlier skill catalog updates');
    expect(body).toContain('- `skill-0`: skill-0 description');
    expect(body).not.toContain('No skills are currently available');
    expect(state.notice?.told).toContain('skill-0');
  });
});
