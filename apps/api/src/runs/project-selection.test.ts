/**
 * The untrusted boundary around the write-once Project selection
 * (project-discovery D2). These cases are the strict payload contract: a
 * malformed, retyped, extended, or unsupported-version value is rejected
 * rather than reinterpreted, and recovery refuses it before any live Project
 * lookup or model request.
 */
import { drizzle } from 'drizzle-orm/postgres-js';

import { type RunEvent } from '../db/schema';
import { type UnknownRecord } from '@workspace/runtime-safety';
import { ModelContextExecutionError } from './model-context-errors';
import {
  parseProjectBoundPayload,
  type ProjectBoundPayload,
  type ProjectSelection,
} from './project-selection';
import {
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
async function rejection(promise: Promise<void>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;

    throw error;
  }

  throw new Error('Expected the operation to reject.');
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
