import { drizzle } from 'drizzle-orm/postgres-js';
import { type ChatDelivery, type ChatJob } from '../db/schema';
import * as schema from '../db/schema';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import * as hostFiles from '../tools/artifacts/host-files';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { createJobNoticeContext } from './job-notice-context';

const CHAT_ID = '33333333-3333-4333-8333-333333333333';
const OWNER_ID = 'owner-1';
const MESSAGE_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RUN_ID = '99999999-9999-4999-8999-999999999999';
const HOST_DIRECTORY = '/verified/chat/artifacts/bash-4';

beforeEach(() => {
  vi.spyOn(hostFiles, 'existingArtifactHostDirectory').mockResolvedValue(
    HOST_DIRECTORY,
  );
});

function job(overrides: Partial<ChatJob> = {}): ChatJob {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    chatId: CHAT_ID,
    ownerUserId: OWNER_ID,
    executor: 'bash',
    seq: 4,
    state: 'succeeded',
    stoppedBy: null,
    runId: RUN_ID,
    toolCallId: 'call-4',
    workerInstanceId: '44444444-4444-4444-8444-444444444444',
    pid: null,
    startedAt: new Date('2026-11-12T12:00:00.000Z'),
    settledAt: new Date('2026-11-12T12:00:03.000Z'),
    deadlineAt: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    result: { exitCode: 0 },
    outputs: ['stdout'],
    artifactId: null,
    artifactReadable: true,
    settings: { modelId: 'gpt-5.5', permissionMode: 'default' },
    ...overrides,
  };
}

function notice(runId: string, senderRef: string | null): ChatDelivery {
  return {
    id: MESSAGE_ID,
    chatId: CHAT_ID,
    ownerUserId: OWNER_ID,
    producer: 'job',
    senderRef,
    mode: 'notice',
    parts: [],
    settings: { modelId: 'gpt-5.5', permissionMode: 'default' },
    state: 'delivered',
    position: 1,
    deliveredMessageId: MESSAGE_ID,
    runId,
    createdAt: new Date('2026-11-12T12:00:00.000Z'),
    updatedAt: new Date('2026-11-12T12:00:00.000Z'),
  };
}

function setup(input: {
  notices: Array<ChatDelivery>;
  jobs: Map<string, ChatJob>;
  chunkText?: string;
  artifactTexts?: Readonly<Record<number, string | null>>;
}) {
  const tx = drizzle.mock({ schema });
  vi.spyOn(
    ChatDeliveriesRepository.prototype,
    'listDeliveredJobNotices',
  ).mockResolvedValue(input.notices);
  vi.spyOn(ChatJobsRepository.prototype, 'findById').mockImplementation(
    (_chatId, _ownerUserId, id) => Promise.resolve(input.jobs.get(id)),
  );
  vi.spyOn(ChatJobsRepository.prototype, 'readOutputTail').mockResolvedValue(
    Buffer.from(input.chunkText ?? 'chunk output'),
  );
  vi.spyOn(ArtifactsRepository.prototype, 'readPartTail').mockImplementation(
    (_chatId, locator) => {
      const artifactText = input.artifactTexts?.[locator.seq];

      return Promise.resolve(
        artifactText === undefined || artifactText === null
          ? undefined
          : Buffer.from(artifactText),
      );
    },
  );

  return createJobNoticeContext({
    tx,
    chatId: CHAT_ID,
    ownerUserId: OWNER_ID,
    messageId: MESSAGE_ID,
    runId: RUN_ID,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('createJobNoticeContext', () => {
  it('authors output only from delivered settled notices on the current run', async () => {
    const accepted = job({ id: 'accepted' });
    const running = job({ id: 'running', state: 'running' });

    const items = await setup({
      notices: [
        notice(OTHER_RUN_ID, 'foreign-run'),
        notice(RUN_ID, null),
        notice(RUN_ID, 'missing'),
        notice(RUN_ID, 'running'),
        notice(RUN_ID, accepted.id),
      ],
      jobs: new Map<string, ChatJob>([
        ['foreign-run', job({ id: 'foreign-run' })],
        ['running', running],
        [accepted.id, accepted],
      ]),
      chunkText: 'accepted settled output',
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.data.text).toContain('accepted settled output');
    expect(items[0]?.data.payload).toMatchObject({ locator: 'job://bash-4' });
    expect(items[0]?.data.text).not.toContain('foreign-run');
    expect(items[0]?.data.text).not.toContain('running');
  });

  it('uses readable artifact content instead of chunk output and authors its host directory', async () => {
    const items = await setup({
      notices: [notice(RUN_ID, 'artifact-job')],
      jobs: new Map<string, ChatJob>([
        [
          'artifact-job',
          job({
            id: 'artifact-job',
            artifactId: '66666666-6666-4666-8666-666666666666',
            artifactReadable: true,
          }),
        ],
      ]),
      chunkText: 'private chunk output',
      artifactTexts: { 4: 'readable artifact output' },
    });

    expect(items[0]?.data.text).toContain('readable artifact output');
    expect(items[0]?.data.text).toContain(HOST_DIRECTORY);
    expect(items[0]?.data.text).not.toContain('private chunk output');
  });

  it('falls back to chunk output when artifact bytes are absent and withholds unreadable artifact details', async () => {
    const items = await setup({
      notices: [notice(RUN_ID, 'fallback'), notice(RUN_ID, 'unreadable')],
      jobs: new Map<string, ChatJob>([
        [
          'fallback',
          job({
            id: 'fallback',
            artifactId: '77777777-7777-4777-8777-777777777777',
            artifactReadable: true,
          }),
        ],
        [
          'unreadable',
          job({
            id: 'unreadable',
            seq: 5,
            artifactId: '88888888-8888-4888-8888-888888888888',
            artifactReadable: false,
          }),
        ],
      ]),
      chunkText: 'permitted chunk tail',
      artifactTexts: { 4: null, 5: 'unreadable private artifact output' },
    });

    expect(items).toHaveLength(2);
    expect(items[0]?.data.text).toContain('permitted chunk tail');
    expect(items[0]?.data.text).toContain(HOST_DIRECTORY);
    expect(items[1]?.data.text).toContain('permitted chunk tail');
    expect(items[1]?.data.text).not.toContain(HOST_DIRECTORY);
    expect(items[1]?.data.text).not.toContain(
      'unreadable private artifact output',
    );
  });
});
