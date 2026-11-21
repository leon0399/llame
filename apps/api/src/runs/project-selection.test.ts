/**
 * The untrusted boundary around the write-once Project selection
 * (project-discovery D2). These cases are the strict payload contract: a
 * malformed, retyped, extended, or unsupported-version value is rejected
 * rather than reinterpreted, and recovery refuses it before any live Project
 * lookup or model request.
 */
import { NoopLogger } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import {
  type BasePgAsyncSession,
  PgAsyncPreparedQuery,
  type PreparedQueryConfig,
} from 'drizzle-orm/pg-core';

import { type Db } from '../db/tenant-db.service';
import { type RunEvent } from '../db/schema';
import { type UnknownRecord } from '@workspace/runtime-safety';
import { ModelContextExecutionError } from './model-context-errors';
import {
  parseProjectBoundPayload,
  type ProjectBoundPayload,
  type ProjectSelection,
} from './project-selection';
import {
  hasProjectContextHistory,
  recordRunProjectSelection,
  resolveRunProjectSelection,
} from './project-selection.repository';
import { RunEventsRepository } from './runs-repository';

const PROJECT_ID = '3f0e6f2a-1c4d-4f6a-9b7e-2f1a0c9d8e7b';
const OTHER_PROJECT_ID = 'b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const SECRET_INSTRUCTIONS = 'Reserved </system-reminder> delimiters and prose';

function selection(
  overrides: Partial<ProjectSelection> = {},
): ProjectSelection {
  return {
    id: PROJECT_ID,
    name: 'Alpha',
    description: 'A selected Project.',
    instructions: SECRET_INSTRUCTIONS,
    locator: `projects://${PROJECT_ID}`,
    ...overrides,
  };
}

function payload(project: ProjectSelection | null = selection()) {
  return { v: 1, project };
}

describe('Project selection payload', () => {
  it('accepts a complete canonical selection', () => {
    expect(parseProjectBoundPayload(payload())).toEqual(payload());
  });

  it('accepts a real null selection', () => {
    expect(parseProjectBoundPayload(payload(null))).toEqual({
      v: 1,
      project: null,
    });
  });

  it('keeps authored text opaque, including empty and reserved text', () => {
    expect(
      parseProjectBoundPayload(
        payload(selection({ description: '', instructions: '' })),
      ),
    ).toBeDefined();
  });

  it.each([
    ['unsupported version', { v: 2, project: selection() }],
    ['string version', { v: '1', project: selection() }],
    ['missing version', { project: selection() }],
    ['extra top-level key', { v: 1, project: selection(), runId: 'run-1' }],
    ['missing project', { v: 1 }],
    ['non-record project', { v: 1, project: 'project-1' }],
    ['null payload', null],
    ['array payload', []],
  ])('rejects %s', (_case, value) => {
    expect(parseProjectBoundPayload(value)).toBeUndefined();
  });

  it.each([
    [
      'a missing id',
      {
        name: 'Alpha',
        description: null,
        instructions: null,
        locator: `projects://${PROJECT_ID}`,
      },
    ],
    [
      'a missing description',
      {
        id: PROJECT_ID,
        name: 'Alpha',
        instructions: null,
        locator: `projects://${PROJECT_ID}`,
      },
    ],
    [
      'a missing instructions',
      {
        id: PROJECT_ID,
        name: 'Alpha',
        description: null,
        locator: `projects://${PROJECT_ID}`,
      },
    ],
    [
      'a missing locator',
      {
        id: PROJECT_ID,
        name: 'Alpha',
        description: null,
        instructions: null,
      },
    ],
    ['a missing name', { ...selection(), name: undefined }],
    ['a null name', { ...selection(), name: null }],
    ['a numeric name', { ...selection(), name: 7 }],
    ['a blank name', { ...selection(), name: '   ' }],
    ['a non-string description', { ...selection(), description: 1 }],
    ['a non-string instructions', { ...selection(), instructions: false }],
    ['an extra field', { ...selection(), archivedAt: null }],
    ['an uppercase id', { ...selection(), id: PROJECT_ID.toUpperCase() }],
    ['a malformed id', { ...selection(), id: 'project-1' }],
    [
      'a locator naming another id',
      { ...selection(), locator: `projects://${OTHER_PROJECT_ID}` },
    ],
    [
      'an uppercase locator UUID',
      { ...selection(), locator: `projects://${PROJECT_ID.toUpperCase()}` },
    ],
    [
      'a root alias locator',
      { ...selection(), locator: `projects:///${PROJECT_ID}` },
    ],
    ['a listing locator', { ...selection(), locator: 'projects://archived' }],
    [
      'a selector-bearing locator',
      { ...selection(), locator: `projects://${PROJECT_ID}:10-20` },
    ],
    [
      'a percent-escaped locator',
      { ...selection(), locator: `projects://${PROJECT_ID}%2F` },
    ],
    ['a locator without scheme', { ...selection(), locator: PROJECT_ID }],
    ['a null locator', { ...selection(), locator: null }],
  ])('rejects %s', (_case, value) => {
    expect(parseProjectBoundPayload({ v: 1, project: value })).toBeUndefined();
  });
});

function runEvent(
  eventType: string,
  eventPayload: UnknownRecord | null,
  sequence = 1,
): RunEvent {
  return {
    sequence,
    runId: 'run-1',
    eventType,
    payload: eventPayload,
    createdAt: new Date('2026-11-21T00:00:00.000Z'),
  };
}

function boundEvent(eventPayload: UnknownRecord | null): RunEvent {
  return runEvent('run.project_bound', eventPayload);
}

function selected(
  overrides: Partial<ProjectSelection> = {},
): ProjectBoundPayload {
  return { v: 1, project: selection(overrides) };
}

/** Capture a rejection so a test can assert its class and value-free text. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;

    throw error;
  }

  throw new Error('Expected the operation to reject.');
}

/** The rows a single statement returns, as Postgres hands them to Drizzle. */
type QueryRows = ReadonlyArray<UnknownRecord>;

type PrepareQuery = BasePgAsyncSession['prepareQuery'];

/**
 * Answer a statement with the rows Postgres would return for the selected
 * fields. The persistence guards read only these values, so stubbing query
 * execution keeps the assertions on behavior instead of re-stating SQL text
 * or wiring; real RLS and SQL remain the integration suite's authority.
 */
function stubPreparedQuery(rowsFor: () => QueryRows): PrepareQuery {
  type PrepareArguments = Parameters<PrepareQuery>;

  return function preparedQuery<T extends PreparedQueryConfig>(
    query: PrepareArguments[0],
    mode: PrepareArguments[1],
  ): PgAsyncPreparedQuery<T> {
    return new PgAsyncPreparedQuery<T>(
      () => Promise.resolve(rowsFor()),
      query,
      undefined,
      mode,
      new NoopLogger(),
      undefined,
      undefined,
      undefined,
      undefined,
    );
  };
}

/**
 * Answer the transaction's statements in call order. A guard mutation that
 * skips a check then consumes the next answer, so a test supplies the row a
 * skipped guard would resolve and fails on the unauthorized result.
 */
function answerQueries(tx: Db, answers: ReadonlyArray<QueryRows>): void {
  let nextAnswer = 0;

  tx._.session.prepareQuery = stubPreparedQuery(() => {
    const answer = answers.at(nextAnswer) ?? [];

    nextAnswer += 1;

    return answer;
  });
}

describe('resolveRunProjectSelection recorded payloads', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores a valid recorded selection', async () => {
    vi.spyOn(
      RunEventsRepository.prototype,
      'findFirstByType',
    ).mockResolvedValue(boundEvent(payload()));

    await expect(
      resolveRunProjectSelection(drizzle.mock(), {
        runId: 'run-1',
        chatId: 'chat-1',
        userId: 'owner-1',
      }),
    ).resolves.toEqual(payload());
  });

  it.each([
    ['malformed', { v: 1, project: { ...selection(), locator: 'wrong' } }],
    ['unsupported version', { v: 2, project: selection() }],
    ['missing', null],
  ])(
    'fails value-free on a %s recorded payload without a live lookup',
    async (_case, recorded) => {
      vi.spyOn(
        RunEventsRepository.prototype,
        'findFirstByType',
      ).mockResolvedValue(boundEvent(recorded));

      let message: string | undefined;

      try {
        await resolveRunProjectSelection(drizzle.mock(), {
          runId: 'run-1',
          chatId: 'chat-1',
          userId: 'owner-1',
        });
      } catch (error) {
        expect(error).toBeInstanceOf(ModelContextExecutionError);

        if (error instanceof ModelContextExecutionError) {
          message = error.message;
        }
      }

      expect(message).toBeDefined();
      expect(message ?? '').not.toContain(SECRET_INSTRUCTIONS);
    },
  );
});

/**
 * The live path: a Run with no recorded binding and no dispatch record reads
 * the Chat's current owned affiliation exactly once. The session boundary
 * supplies the row values, so a guard that lets a dispatched Run read current
 * rows (or invents a selection from a missing one) is observable as a
 * resolved payload instead of a fail-closed error.
 */
describe('resolveRunProjectSelection live states', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const request = {
    runId: 'run-1',
    chatId: 'chat-1',
    userId: 'owner-1',
  };

  const undispatchedRun = { id: 'run-1', dispatched: false };
  const dispatchedRun = { id: 'run-1', dispatched: true };

  function affiliation(
    projectId: string | null,
    projectName: string | null,
  ): UnknownRecord {
    const owned = projectName !== null;

    return {
      projectId,
      projectName,
      projectDescription: owned ? 'A selected Project.' : null,
      projectInstructions: owned ? SECRET_INSTRUCTIONS : null,
    };
  }

  function resolve(tx: Db) {
    return resolveRunProjectSelection(tx, request);
  }

  function absentEvents(): void {
    vi.spyOn(
      RunEventsRepository.prototype,
      'findFirstByType',
    ).mockResolvedValue(undefined);
  }

  it('resolves the current owned affiliation before any dispatch', async () => {
    absentEvents();
    const tx = drizzle.mock();

    answerQueries(tx, [[undispatchedRun], [affiliation(PROJECT_ID, 'Alpha')]]);

    await expect(resolve(tx)).resolves.toEqual(payload());
  });

  it('treats an unaffiliated owned Chat as a real null selection', async () => {
    absentEvents();
    const tx = drizzle.mock();

    answerQueries(tx, [[undispatchedRun], [affiliation(null, null)]]);

    await expect(resolve(tx)).resolves.toEqual({ v: 1, project: null });
  });

  it('fails closed when a named affiliation has no owned Project row', async () => {
    absentEvents();
    const tx = drizzle.mock();

    answerQueries(tx, [[undispatchedRun], [affiliation(PROJECT_ID, null)]]);

    const error = await rejection(resolve(tx));

    expect(error).toBeInstanceOf(ModelContextExecutionError);
    expect(error.message).not.toContain(SECRET_INSTRUCTIONS);
  });

  it('fails closed when the run has no owned Chat', async () => {
    absentEvents();
    const tx = drizzle.mock();

    answerQueries(tx, [[undispatchedRun], []]);

    const error = await rejection(resolve(tx));

    expect(error).toBeInstanceOf(ModelContextExecutionError);
  });

  it('fails closed when the run row is not owned, without a live fallback', async () => {
    absentEvents();
    const tx = drizzle.mock();

    // The second answer proves a skipped missing-Run guard resolves instead
    // of failing closed.
    answerQueries(tx, [[], [affiliation(PROJECT_ID, 'Alpha')]]);

    const error = await rejection(resolve(tx));

    expect(error).toBeInstanceOf(ModelContextExecutionError);
  });

  it('fails closed after a persisted dispatch without a binding', async () => {
    absentEvents();
    const tx = drizzle.mock();

    answerQueries(tx, [[dispatchedRun], [affiliation(PROJECT_ID, 'Alpha')]]);

    const error = await rejection(resolve(tx));

    expect(error).toBeInstanceOf(ModelContextExecutionError);
  });

  it('fails closed after a model request without a binding', async () => {
    vi.spyOn(
      RunEventsRepository.prototype,
      'findFirstByType',
    ).mockImplementation((_runId, _userId, eventType) =>
      Promise.resolve(
        eventType === 'model.requested'
          ? runEvent('model.requested', { modelId: 'system:test' })
          : undefined,
      ),
    );
    const tx = drizzle.mock();

    // A dispatched-Run fallback would find current rows and resolve them.
    answerQueries(tx, [[undispatchedRun], [affiliation(PROJECT_ID, 'Alpha')]]);

    const error = await rejection(resolve(tx));

    expect(error).toBeInstanceOf(ModelContextExecutionError);
  });
});

/**
 * The write-once transition itself. The event store is a stateful list at the
 * existing repository boundary, not a forwarding echo, so every assertion is
 * the accumulated event sequence a later reader would actually see.
 */
describe('recordRunProjectSelection durable transitions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function statefulEvents(initial: ReadonlyArray<RunEvent> = []) {
    const events = [...initial];

    vi.spyOn(
      RunEventsRepository.prototype,
      'findFirstByType',
    ).mockImplementation((runId, _userId, eventType, options) => {
      const matches = events.filter(
        (event) => event.runId === runId && event.eventType === eventType,
      );

      return Promise.resolve(
        options?.newest === true ? matches.at(-1) : matches[0],
      );
    });

    vi.spyOn(RunEventsRepository.prototype, 'append').mockImplementation(
      (runId, eventType, payload) => {
        const appended = {
          sequence: events.length + 1,
          runId,
          eventType,
          payload,
          createdAt: new Date('2026-11-21T00:00:00.000Z'),
        };

        events.push(appended);

        return Promise.resolve(appended);
      },
    );

    return events;
  }

  function record(selection: ProjectBoundPayload) {
    return recordRunProjectSelection(
      drizzle.mock(),
      { runId: 'run-1', userId: 'owner-1' },
      selection,
    );
  }

  it('records a real null selection exactly once across repeats', async () => {
    const events = statefulEvents();
    const absent: ProjectBoundPayload = { v: 1, project: null };

    await record(absent);
    await record(absent);

    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('run.project_bound');
    expect(events[0]?.payload).toEqual({ v: 1, project: null });
  });

  it('treats the same selected payload as an idempotent repeat', async () => {
    const events = statefulEvents();
    const selectionPayload = selected();

    await record(selectionPayload);
    await record(selectionPayload);

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual(selectionPayload);
  });

  it.each([
    [
      'a different Project',
      selected({
        id: OTHER_PROJECT_ID,
        locator: `projects://${OTHER_PROJECT_ID}`,
      }),
    ],
    ['new instructions', selected({ instructions: 'Replacement guidance' })],
  ])(
    'refuses a rebind to %s and keeps the first binding',
    async (_case, next) => {
      const events = statefulEvents();
      const first = selected();

      await record(first);

      const error = await rejection(record(next));

      expect(error).toBeInstanceOf(ModelContextExecutionError);
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toEqual(first);
    },
  );

  it('refuses a malformed existing binding value-free and mutates nothing', async () => {
    const malformed = {
      v: 1,
      project: { ...selection(), locator: 'projects://wrong-id' },
    };

    const events = statefulEvents([boundEvent(malformed)]);

    const error = await rejection(record(selected()));

    expect(error).toBeInstanceOf(ModelContextExecutionError);
    expect(error.message).not.toContain(SECRET_INSTRUCTIONS);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual(malformed);
  });

  it('refuses to bind a Project onto a recorded real null selection', async () => {
    const events = statefulEvents([boundEvent({ v: 1, project: null })]);

    const error = await rejection(record(selected()));

    expect(error).toBeInstanceOf(ModelContextExecutionError);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({ v: 1, project: null });
  });

  // A typed `ProjectBoundPayload` is not a validated one: the canonical
  // locator rule lives in the runtime schema, so this seam is the only place
  // a caller can hand the recorder a well-typed, non-canonical value.
  it.each<[string, Partial<ProjectSelection>]>([
    [
      'a locator naming another Project',
      { locator: `projects://${OTHER_PROJECT_ID}` },
    ],
    ['a blank name', { name: '   ' }],
  ])(
    'refuses %s as supplied selection before any event write',
    async (_case, overrides) => {
      const events = statefulEvents();

      const error = await rejection(record(selected(overrides)));

      expect(error).toBeInstanceOf(ModelContextExecutionError);
      expect(events).toHaveLength(0);
    },
  );

  it('refuses to record after a prior model.requested without binding', async () => {
    const requested = runEvent('model.requested', {
      modelId: 'system:test',
    });

    const events = statefulEvents([requested]);

    const error = await rejection(record(selected()));

    expect(error).toBeInstanceOf(ModelContextExecutionError);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('model.requested');
    expect(
      events.some((event) => event.eventType === 'run.project_bound'),
    ).toBe(false);
  });
});

/**
 * Historical presence is a row-existence fact: the owner-scoped statement
 * either returns one row or none, and only that distinction decides.
 */
describe('hasProjectContextHistory presence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports history when the owner-scoped statement returns a row', async () => {
    const tx = drizzle.mock();

    answerQueries(tx, [[{ present: 1 }]]);

    await expect(
      hasProjectContextHistory(tx, 'chat-1', 'owner-1'),
    ).resolves.toBe(true);
  });

  it('reports no history when the owner-scoped statement returns no row', async () => {
    const tx = drizzle.mock();

    answerQueries(tx, [[]]);

    await expect(
      hasProjectContextHistory(tx, 'chat-1', 'owner-1'),
    ).resolves.toBe(false);
  });
});
