import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type KnowledgeSpace } from '../db/schema/knowledge-spaces';
import { type Db } from '../db/tenant-db.service';
import { KnowledgeSpaceRepository } from './knowledge-space.repository';

const OWNER_ID = 'owner-a';
const SPACE_ID = '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e';
const NOW = new Date('2026-08-23T12:00:00.000Z');

type Row = { id: string } | KnowledgeSpace;

function fakeDb(input: {
  selects: Array<Array<Row>>;
  inserted?: Array<Row>;
  events: Array<string>;
  onConflict: ReturnType<typeof vi.fn>;
}): Db {
  let selectIndex = 0;
  const db = drizzle.mock({ schema });
  Object.assign(db, {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = input.selects[selectIndex++] ?? [];
          const limit = () => {
            input.events.push('select');
            return Promise.resolve(rows);
          };
          const orderedLimit = () => {
            input.events.push('select:ordered');
            return Promise.resolve(rows);
          };
          return {
            for: (mode: string) => ({
              limit: () => {
                input.events.push(`select:${mode}`);
                return Promise.resolve(rows);
              },
            }),
            limit,
            orderBy: () => ({
              for: (mode: string) => ({
                limit: () => {
                  input.events.push(`select:ordered:${mode}`);
                  return Promise.resolve(rows);
                },
              }),
              limit: orderedLimit,
            }),
          };
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: input.onConflict,
      }),
    }),
  });

  input.onConflict.mockImplementation(() => ({
    returning: () => {
      input.events.push('insert');
      return Promise.resolve(input.inserted ?? []);
    },
  }));
  return db;
}

describe('KnowledgeSpaceRepository.createOrGet', () => {
  it('locks the owner before reading and does not insert when a space exists', async () => {
    const events: Array<string> = [];
    const existing = {
      knowledgeSpaceId: SPACE_ID,
      ownerUserId: OWNER_ID,
      name: 'Personal',
      createdAt: NOW,
      updatedAt: NOW,
    };
    const onConflict = vi.fn();
    const repository = new KnowledgeSpaceRepository(
      fakeDb({ selects: [[{ id: OWNER_ID }], [existing]], events, onConflict }),
    );

    await expect(repository.createOrGet(OWNER_ID)).resolves.toEqual(existing);
    expect(events).toEqual(['select:update', 'select:ordered']);
    expect(onConflict).not.toHaveBeenCalled();
  });

  it('uses targetless conflict handling and rereads after a conflict', async () => {
    const events: Array<string> = [];
    const existing = {
      knowledgeSpaceId: SPACE_ID,
      ownerUserId: OWNER_ID,
      name: 'Personal',
      createdAt: NOW,
      updatedAt: NOW,
    };
    const onConflict = vi.fn();
    const repository = new KnowledgeSpaceRepository(
      fakeDb({
        selects: [[{ id: OWNER_ID }], [], [existing]],
        inserted: [],
        events,
        onConflict,
      }),
    );

    await expect(repository.createOrGet(OWNER_ID)).resolves.toEqual(existing);
    expect(events).toEqual([
      'select:update',
      'select:ordered',
      'insert',
      'select:ordered',
    ]);
    expect(onConflict).toHaveBeenCalledWith();
  });
});
