import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { NativeFilesRepository } from './native-files-repository';

describe('NativeFilesRepository prior outcomes', () => {
  it('identifies an unknown MCP dispatch without allowing a replay', async () => {
    const db: Db = drizzle.mock({ schema });
    const query = db.select({
      eventType: schema.runEvents.eventType,
      payload: schema.runEvents.payload,
    });
    const terminal = Promise.resolve([
      {
        eventType: 'native.attempt',
        payload: { toolCallId: 'mcp-call', operation: 'mcp' },
      },
    ]);
    Object.assign(query, {
      from: () => query,
      where: () => query,
      orderBy: () => query,
      limit: () => terminal,
    });
    vi.spyOn(db, 'select').mockReturnValue(query);

    await expect(
      new NativeFilesRepository(db).priorOutcome('run-1', 'mcp-call'),
    ).resolves.toEqual({
      status: 'error',
      type: 'outcome_unknown',
      message:
        'A previous host command, mutation, or MCP operation may have executed; it will not be repeated.',
    });
  });
});
