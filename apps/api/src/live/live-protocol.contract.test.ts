/**
 * The hub against the published live protocol (`apps/api/asyncapi.yaml`):
 * every message the tracker emits must validate against the generated
 * schema, and the document's `RunStatus` must stay identical to the
 * database enum it mirrors.
 */

import { runStatus, type RunStatus } from '../db/schema/chats';
import {
  liveMessageSchema,
  runStatusSchema,
  type RunStatus as ProtocolRunStatus,
} from './generated/live-protocol';
import { RunProgressTracker, type ChangeNotification } from './live-messages';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

const owner = 'user-a';
const chat = '11111111-1111-4111-8111-111111111111';
const run = '22222222-2222-4222-8222-222222222222';

describe('live protocol contract', () => {
  it('mirrors the database run status enum exactly', () => {
    const sameType: Equal<ProtocolRunStatus, RunStatus> = true;
    expect(sameType).toBe(true);
    expect([...runStatusSchema.options].sort()).toEqual(
      [...runStatus.enumValues].sort(),
    );
  });

  it('emits only messages the published document describes', () => {
    const tracker = new RunProgressTracker();
    const notifications: Array<ChangeNotification> = [
      { k: 'chat', op: 'insert', owner, chat },
      { k: 'chat', op: 'update', owner, chat },
      { k: 'chat', op: 'delete', owner, chat },
      { k: 'project', op: 'update', owner, project: chat },
      { k: 'pin', op: 'insert', owner, item: chat },
      { k: 'run', op: 'insert', owner, chat, run, status: 'queued' },
      { k: 'run', op: 'update', owner, chat, run, status: 'running_model' },
      ...[
        'model.requested',
        'reasoning.delta',
        'model.delta',
        'tool.requested',
        'tool.completed',
        'model.requested',
        'run.completed',
      ].map(
        (type, seq): ChangeNotification => ({
          k: 'run_event',
          op: 'insert',
          owner,
          chat,
          run,
          seq,
          type,
        }),
      ),
    ];

    const messages = notifications.flatMap((n) => tracker.apply(n) ?? []);
    messages.push({ type: 'resync' });

    expect(new Set(messages.map((m) => m.type))).toEqual(
      new Set([
        'chat.changed',
        'project.changed',
        'pin.changed',
        'run.progress',
        'resync',
      ]),
    );
    for (const message of messages) {
      expect(liveMessageSchema.safeParse(message).error).toBeUndefined();
    }
  });
});
