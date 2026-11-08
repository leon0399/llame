import { type AuthoredContextItemPart } from '../chats/context-item';
import {
  type InRunAttemptProducer,
  type InRunGitWorld,
  type InRunToolCall,
} from '../runs/in-run-context-items';
import { createGitProducer } from './git-context-producer';
import { createGitItem } from './git-item';
import { type GitObservation } from './git-state-view';

const RUN_ID = '3b0f5b8e-6d2e-4c0a-9c1d-0f6a7c8d9e10';
const CLEAN: GitObservation = { kind: 'not_a_repository' };
const FAILED: GitObservation = { kind: 'unavailable', reason: 'git_failed' };

const textOf = (observation: GitObservation) =>
  createGitItem({ runId: RUN_ID, observation }).data.text;

function attempt(world: InRunGitWorld | undefined) {
  return createGitProducer().beginAttempt({
    runId: RUN_ID,
    chatId: 'chat-1',
    userId: 'user-1',
    admitsRead: () => true,
    git: world,
  });
}

function entered(
  state: string,
  root = '/repo',
  status: 'success' | 'error' = 'success',
): InRunToolCall {
  return {
    toolName: 'enter_workspace',
    input: { path: root },
    workspaceRoot: root,
    result:
      status === 'success'
        ? { status: 'success', root, state }
        : { status: 'error', type: 'permission_denied', message: 'no' },
  };
}

async function step(producer: InRunAttemptProducer) {
  const staged: Array<AuthoredContextItemPart> = [];
  await producer.prepareStep({
    messages: [],
    stepNumber: 1,
    stage: (part) => staged.push(part),
  });
  return staged;
}

function worldOf(
  observe: (root: string) => Promise<GitObservation>,
  toldText?: string,
): InRunGitWorld {
  return { observe: vi.fn(observe), toldText };
}

describe('git producer, turn start', () => {
  const prepare = (observation: GitObservation, toldText: string | undefined) =>
    createGitProducer().prepareTurn?.({
      runId: RUN_ID,
      admitsRead: () => false,
      seenKeys: new Set(),
      git: { observation, toldText },
    });

  it('tells a state the history has not told', async () => {
    const item = await prepare(CLEAN, undefined);

    expect(item?.data.producer).toBe('git');
    expect(item?.data.text).toBe(textOf(CLEAN));
    expect(item?.data.runId).toBe(RUN_ID);
  });

  it('adds nothing when the history told the same text', async () => {
    await expect(prepare(CLEAN, textOf(CLEAN))).resolves.toBeUndefined();
  });

  it('tells a changed state once', async () => {
    const item = await prepare(FAILED, textOf(CLEAN));

    expect(item?.data.text).toBe(textOf(FAILED));
  });

  it('tells nothing for an unbound Chat', async () => {
    await expect(
      createGitProducer().prepareTurn?.({
        runId: RUN_ID,
        admitsRead: () => false,
        seenKeys: new Set(),
      }),
    ).resolves.toBeUndefined();
  });
});

describe('git producer, in-Run entry', () => {
  it('stages the state after an entry that bound the root', async () => {
    const world = worldOf(() => Promise.resolve(CLEAN), textOf(CLEAN));
    const producer = attempt(world);

    producer.observeToolCall?.(entered('bound'));
    const staged = await step(producer);

    // Told text equals the new text, yet a new binding always tells.
    expect(staged.map((part) => part.data.text)).toEqual([textOf(CLEAN)]);
    expect(world.observe).toHaveBeenCalledExactlyOnceWith('/repo');
  });

  it('observes the root the result names, not the submitted spelling', async () => {
    const world = worldOf(() => Promise.resolve(CLEAN));
    const producer = attempt(world);

    producer.observeToolCall?.({
      ...entered('switched', '/real/repo'),
      input: { path: '/link' },
    });
    await step(producer);

    expect(world.observe).toHaveBeenCalledExactlyOnceWith('/real/repo');
  });

  it('stages nothing for a step without an entry', async () => {
    const world = worldOf(() => Promise.resolve(CLEAN));
    const producer = attempt(world);

    expect(await step(producer)).toEqual([]);
    expect(world.observe).not.toHaveBeenCalled();
  });

  it('observes at the step after the result, once', async () => {
    const world = worldOf(() => Promise.resolve(CLEAN));
    const producer = attempt(world);

    // The admission observation carries no result and triggers nothing.
    producer.observeToolCall?.({
      toolName: 'enter_workspace',
      input: { path: '/repo' },
      workspaceRoot: undefined,
    });
    expect(await step(producer)).toEqual([]);
    producer.observeToolCall?.(entered('bound'));
    expect(await step(producer)).toHaveLength(1);
    expect(await step(producer)).toEqual([]);
    expect(world.observe).toHaveBeenCalledOnce();
  });

  it('adds nothing for an unchanged re-entry whose text matches the history', async () => {
    const world = worldOf(() => Promise.resolve(CLEAN), textOf(CLEAN));
    const producer = attempt(world);

    producer.observeToolCall?.(entered('unchanged'));

    expect(await step(producer)).toEqual([]);
    expect(world.observe).toHaveBeenCalledOnce();
  });

  it('tells a changed state after an unchanged re-entry', async () => {
    const world = worldOf(() => Promise.resolve(FAILED), textOf(CLEAN));
    const producer = attempt(world);

    producer.observeToolCall?.(entered('unchanged'));
    const staged = await step(producer);

    expect(staged.map((part) => part.data.text)).toEqual([textOf(FAILED)]);
  });

  it('compares a later re-entry with what this attempt just told', async () => {
    const observations = [CLEAN, CLEAN, FAILED];
    const world = worldOf(() => Promise.resolve(observations.shift() ?? CLEAN));
    const producer = attempt(world);

    producer.observeToolCall?.(entered('bound'));
    expect(await step(producer)).toHaveLength(1);
    producer.observeToolCall?.(entered('unchanged'));
    expect(await step(producer)).toEqual([]);
    producer.observeToolCall?.(entered('unchanged'));
    expect((await step(producer)).map((part) => part.data.text)).toEqual([
      textOf(FAILED),
    ]);
  });

  it('keeps telling when one step holds a binding entry and a re-entry', async () => {
    const world = worldOf(() => Promise.resolve(CLEAN), textOf(CLEAN));
    const producer = attempt(world);

    producer.observeToolCall?.(entered('switched', '/a'));
    producer.observeToolCall?.(entered('unchanged', '/b'));

    expect(await step(producer)).toHaveLength(1);
    expect(world.observe).toHaveBeenCalledExactlyOnceWith('/b');
  });

  it('stages nothing for a failed entry or another tool', async () => {
    const world = worldOf(() => Promise.resolve(CLEAN));
    const producer = attempt(world);

    producer.observeToolCall?.(entered('bound', '/repo', 'error'));
    producer.observeToolCall?.({
      toolName: 'exit_workspace',
      input: {},
      workspaceRoot: '/repo',
      result: { status: 'success' },
    });

    expect(await step(producer)).toEqual([]);
    expect(world.observe).not.toHaveBeenCalled();
  });

  it('tells a failed read as the git failed absence', async () => {
    const world = worldOf(() => Promise.reject(new Error('boom /secret')));
    const producer = attempt(world);

    producer.observeToolCall?.(entered('bound'));
    const staged = await step(producer);

    expect(staged.map((part) => part.data.text)).toEqual([textOf(FAILED)]);
    expect(JSON.stringify(staged)).not.toContain('/secret');
  });

  it('does nothing without the git capability', async () => {
    const producer = attempt(undefined);

    producer.observeToolCall?.(entered('bound'));

    expect(await step(producer)).toEqual([]);
  });
});
