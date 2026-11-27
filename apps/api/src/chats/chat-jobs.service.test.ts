import { ConflictException, NotFoundException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import { type Chat, type ChatJob } from '../db/schema';
import { type TenantRunner } from '../db/tenant-db.service';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import {
  ChatJobsService,
  JOB_OUTPUT_RESPONSE_BYTES,
  type ChatJobOutput,
  type ChatJobOutputPart,
} from './chat-jobs.service';
import { ChatsRepository } from './chats-repository';

const CHAT = 'chat-1';
const USER = 'owner-1';

function job(overrides: Partial<ChatJob>): ChatJob {
  return {
    id: 'j',
    chatId: CHAT,
    ownerUserId: USER,
    kind: 'bash',
    seq: 1,
    state: 'running',
    stoppedBy: null,
    runId: 'r1',
    toolCallId: 't1',
    intent: null,
    command: null,
    machineName: 'test-machine',
    daemonInstanceId: 'd1',
    daemonJobId: 'dj1',
    delivery: 'background',
    startedAt: new Date('2026-11-11T10:00:00.000Z'),
    settledAt: null,
    deadlineAt: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    result: null,
    outputs: [],
    artifactId: null,
    artifactReadable: true,
    settings: { selector: 'm', permissionMode: 'default' },
    ...overrides,
  };
}

const OWNED_CHAT: Chat = {
  id: CHAT,
  ownerUserId: USER,
  title: 'Chat',
  visibility: 'private',
  createdAt: new Date('2026-06-29T00:00:00.000Z'),
  updatedAt: new Date('2026-06-29T00:00:00.000Z'),
  archivedAt: null,
  modelSelection: null,
  projectId: null,
  skillCatalogBaseline: null,
  skillCatalogRebakedFrom: null,
  skillCatalogTold: null,
  workspaceRoot: null,
  workspaceExecutorId: null,
  workspaceGeneration: 0,
  artifactSeq: 0,
  workspaceTold: null,
  workspaceToldFrom: null,
  workspaceToldAvailable: null,
  workspaceDetachReason: null,
};

function makeService() {
  const db = drizzle.mock();
  vi.spyOn(db, 'execute').mockResolvedValue(
    Object.assign([], {
      columns: [],
      count: 0,
      command: 'SELECT',
      statement: { name: '', string: '', types: [], columns: [] },
      state: { status: 'I', pid: 0, secret: 0 },
    }),
  );
  const runAs: TenantRunner['runAs'] = (_user, fn) => fn(db);

  return new ChatJobsService({ runAs });
}

function script() {
  return {
    chat: vi
      .spyOn(ChatsRepository.prototype, 'findById')
      .mockResolvedValue(OWNED_CHAT),
    list: vi.spyOn(ChatJobsRepository.prototype, 'listByChat'),
    request: vi.spyOn(ChatJobsRepository.prototype, 'requestStop'),
    find: vi.spyOn(ChatJobsRepository.prototype, 'findById'),
    count: vi.spyOn(ChatJobsRepository.prototype, 'countRunning'),
  };
}

describe('ChatJobsService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists live jobs first, then settled jobs, each oldest first', async () => {
    const s = script();
    s.list.mockResolvedValue([
      job({ id: 'a', state: 'succeeded' }),
      job({ id: 'b', state: 'running' }),
      job({ id: 'c', state: 'failed' }),
      job({ id: 'd', state: 'running' }),
    ]);

    const rows = await makeService().list(CHAT, USER);

    expect(rows.map((row) => row.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('answers not found for a Chat that the owner does not hold, and touches nothing', async () => {
    const s = script();

    s.chat.mockResolvedValue(undefined);

    await expect(makeService().list(CHAT, USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(makeService().stop(CHAT, 'j', USER)).rejects.toThrow(
      `Chat ${CHAT} not found`,
    );
    expect(s.list).not.toHaveBeenCalled();
  });

  describe('output', () => {
    const BOUND = JOB_OUTPUT_RESPONSE_BYTES;

    /** A settled job whose stored stdout is `stored`, read through its window. */
    function stored(content: Buffer) {
      const s = script();

      s.find.mockResolvedValue(
        job({ state: 'succeeded', artifactId: 'a1', outputs: ['stdout'] }),
      );
      vi.spyOn(
        ArtifactsRepository.prototype,
        'readPartWindow',
      ).mockImplementation((_chat, _locator, maxBytes) =>
        Promise.resolve({
          size: content.length,
          window: content.subarray(Math.max(0, content.length - maxBytes - 1)),
        }),
      );

      return makeService().output(CHAT, 'j', USER);
    }

    it('answers 404 for an unknown job and 409 for a running one', async () => {
      const s = script();

      s.find.mockResolvedValueOnce(undefined);
      await expect(makeService().output(CHAT, 'j', USER)).rejects.toThrow(
        'Job j not found',
      );

      s.find.mockResolvedValueOnce(job({ state: 'running' }));
      await expect(makeService().output(CHAT, 'j', USER)).rejects.toThrow(
        'The job is still running',
      );
    });

    it('answers unavailable for a settled job without an artifact', async () => {
      script().find.mockResolvedValue(job({ state: 'lost', artifactId: null }));

      await expect(makeService().output(CHAT, 'j', USER)).resolves.toEqual({
        status: 'unavailable',
      });
    });

    it('returns an output at the bound whole and uncut', async () => {
      const content = Buffer.from(`${'a'.repeat(BOUND - 1)}\n`);

      await expect(stored(content)).resolves.toEqual({
        status: 'stored',
        outputs: [
          {
            name: 'stdout',
            content: content.toString(),
            cut: false,
            size: BOUND,
          },
        ],
      });
    });

    it('starts a cut output on the first whole line inside the bound', async () => {
      const first = `${'b'.repeat(99)}\n`;

      const content = Buffer.from(
        `head\n${'x'.repeat(BOUND - 105)}\n${first}tail\n`,
      );

      const [part] = await partsOf(stored(content));

      expect(part).toMatchObject({ cut: true, size: content.length });
      expect(part?.content).toBe(`${first}tail\n`);
    });

    it('keeps the first line whole when the bound starts right after a newline', async () => {
      const tail = `${'c'.repeat(BOUND - 1)}\n`;
      const content = Buffer.from(`head\n${tail}`);
      const [part] = await partsOf(stored(content));

      expect(part?.content).toBe(tail);
    });

    it('ignores a final newline and starts a long line on a whole character', async () => {
      // Two-byte characters with an odd bound start the window mid-character.
      const content = Buffer.from(`${'é'.repeat(BOUND)}\n`);
      const [part] = await partsOf(stored(content));

      expect(part?.cut).toBe(true);
      expect(part?.content.startsWith('é')).toBe(true);
      expect(part?.content.endsWith('é\n')).toBe(true);
      expect(Buffer.byteLength(part?.content ?? '')).toBeLessThanOrEqual(BOUND);
    });
  });
  it('records an owner stop request on a running job', async () => {
    const s = script();
    const running = job({ stopRequestedBy: 'owner' });

    s.request.mockResolvedValue(running);

    await expect(makeService().stop(CHAT, 'j', USER)).resolves.toBe(running);
    expect(s.request).toHaveBeenCalledWith(CHAT, USER, 'j', 'owner');
    expect(s.find).not.toHaveBeenCalled();
  });

  it('answers 200 for a repeat on a job that the owner stopped', async () => {
    const s = script();
    const stopped = job({ state: 'cancelled', stoppedBy: 'owner' });

    s.request.mockResolvedValue(undefined);
    s.find.mockResolvedValue(stopped);

    await expect(makeService().stop(CHAT, 'j', USER)).resolves.toBe(stopped);
  });

  it.each([
    ['succeeded', null],
    ['cancelled', 'assistant'],
    ['lost', null],
  ] as const)('answers 409 for a %s job stopped by %s', async (state, by) => {
    const s = script();

    s.request.mockResolvedValue(undefined);
    s.find.mockResolvedValue(job({ state, stoppedBy: by }));

    await expect(makeService().stop(CHAT, 'j', USER)).rejects.toThrow(
      ConflictException,
    );
  });

  it('answers 409 for an owner-stopped state that is not cancelled', async () => {
    const s = script();

    s.request.mockResolvedValue(undefined);
    s.find.mockResolvedValue(job({ state: 'failed', stoppedBy: 'owner' }));

    await expect(makeService().stop(CHAT, 'j', USER)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('answers not found for an unknown job', async () => {
    const s = script();

    s.request.mockResolvedValue(undefined);
    s.find.mockResolvedValue(undefined);

    await expect(makeService().stop(CHAT, 'j', USER)).rejects.toThrow(
      'Job j not found',
    );
  });

  it('counts running jobs by owner', async () => {
    const s = script();
    const counts = new Map([[CHAT, 2]]);

    s.count.mockResolvedValue(counts);

    await expect(makeService().runningCounts(USER)).resolves.toBe(counts);
    expect(s.count).toHaveBeenCalledWith(USER);
  });
});

async function partsOf(
  answer: Promise<ChatJobOutput>,
): Promise<Array<ChatJobOutputPart>> {
  const output = await answer;

  if (output.status !== 'stored') throw new Error('Expected a stored output');

  return [...output.outputs];
}
