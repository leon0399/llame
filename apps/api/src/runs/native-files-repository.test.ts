import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { NativeFilesRepository } from './native-files-repository';

type StoredEvent = { eventType: string; payload: unknown };

/** A repository whose event query answers exactly `rows`. */
function repositoryOf(...rows: Array<StoredEvent>) {
  const db: Db = drizzle.mock({ schema });
  const query = db.select({
    eventType: schema.runEvents.eventType,
    payload: schema.runEvents.payload,
  });
  const terminal = Promise.resolve(rows);
  Object.assign(query, {
    from: () => query,
    where: () => query,
    orderBy: () => query,
    limit: () => terminal,
  });
  vi.spyOn(db, 'select').mockReturnValue(query);
  return new NativeFilesRepository(db);
}

describe('NativeFilesRepository prior outcomes', () => {
  it('identifies an unknown MCP dispatch without allowing a replay', async () => {
    const repository = repositoryOf({
      eventType: 'native.attempt',
      payload: { toolCallId: 'mcp-call', operation: 'mcp' },
    });

    await expect(repository.priorOutcome('run-1', 'mcp-call')).resolves.toEqual(
      {
        status: 'error',
        type: 'outcome_unknown',
        message:
          'A previous host command, mutation, or MCP operation may have executed; it will not be repeated.',
      },
    );
  });

  it('keeps the artifact locator of a settled error result', async () => {
    const repository = repositoryOf({
      eventType: 'native.result',
      payload: {
        toolCallId: 'bash-call',
        result: {
          status: 'error',
          type: 'command_failed',
          message: 'exit 1',
          artifact: 'artifact://bash-4/stderr',
        },
      },
    });

    await expect(
      repository.priorOutcome('run-1', 'bash-call'),
    ).resolves.toEqual({
      status: 'error',
      type: 'command_failed',
      message: 'exit 1',
      artifact: 'artifact://bash-4/stderr',
    });
  });

  it('drops an artifact value that is not a locator', async () => {
    const repository = repositoryOf({
      eventType: 'native.result',
      payload: {
        toolCallId: 'bash-call',
        result: {
          status: 'error',
          type: 'command_failed',
          message: 'exit 1',
          artifact: 'x',
        },
      },
    });

    await expect(
      repository.priorOutcome('run-1', 'bash-call'),
    ).resolves.toEqual({
      status: 'error',
      type: 'command_failed',
      message: 'exit 1',
    });
  });

  it('treats any other recorded status as the unknown outcome', async () => {
    const repository = repositoryOf({
      eventType: 'native.result',
      payload: {
        toolCallId: 'bash-call',
        result: { status: 'pending', artifact: 'artifact://bash-4/stdout' },
      },
    });

    await expect(
      repository.priorOutcome('run-1', 'bash-call'),
    ).resolves.toMatchObject({ status: 'error', type: 'outcome_unknown' });
  });

  it('keeps the artifact locator of a settled success result', async () => {
    const repository = repositoryOf({
      eventType: 'native.result',
      payload: {
        toolCallId: 'bash-call',
        result: {
          status: 'success',
          exitCode: 0,
          artifact: 'artifact://bash-4/stdout',
        },
      },
    });

    await expect(
      repository.priorOutcome('run-1', 'bash-call'),
    ).resolves.toEqual({
      status: 'success',
      exitCode: 0,
      artifact: 'artifact://bash-4/stdout',
    });
  });
});
