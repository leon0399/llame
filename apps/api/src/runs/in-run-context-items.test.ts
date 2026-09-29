import type { ModelMessage } from 'ai';

import { createInRunContextItems } from './in-run-context-items';
import type { AuthoredContextItemPart } from '../chats/context-item';

function contextItem(text: string): AuthoredContextItemPart {
  return {
    type: 'data-context',
    data: {
      v: 1,
      producer: 'instructions',
      form: 'snapshot',
      runId: 'run-1',
      payload: {},
      text,
    },
  };
}

const TOOL_CALL: ModelMessage = {
  role: 'assistant',
  content: [
    { type: 'tool-call', toolCallId: 'call-1', toolName: 'read', input: {} },
  ],
};

const TOOL_RESULT: ModelMessage = {
  role: 'tool',
  content: [
    {
      type: 'tool-result',
      toolCallId: 'call-1',
      toolName: 'read',
      output: { type: 'text', value: 'file contents' },
    },
  ],
};

function stepMessages(): Array<ModelMessage> {
  return [{ role: 'user', content: 'read the file' }, TOOL_CALL, TOOL_RESULT];
}

describe('createInRunContextItems', () => {
  it('applies nothing when nothing is staged', () => {
    const items = createInRunContextItems();
    items.beginStep({ messages: stepMessages(), stepNumber: 0 });

    expect(items.applyToStep(stepMessages())).toBeUndefined();
  });

  it('inserts a staged item directly after its anchor tool result', () => {
    const following: ModelMessage = { role: 'assistant', content: 'noted' };
    const messages = [...stepMessages(), following];
    const items = createInRunContextItems();
    items.beginStep({ messages, stepNumber: 0 });
    items.stage(contextItem('project rule'));

    const applied = items.applyToStep(messages);

    expect(applied).toHaveLength(messages.length + 1);
    expect(applied?.[3]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'project rule' }],
    });
    // Every original message object is reused by reference in its order; only
    // the item message is new.
    expect(applied?.[0]).toBe(messages[0]);
    expect(applied?.[1]).toBe(messages[1]);
    expect(applied?.[2]).toBe(messages[2]);
    expect(applied?.[4]).toBe(following);
    // The input array and its messages are untouched.
    expect(messages).toHaveLength(4);
  });

  it('recomputes placement when the step messages already carry the item', () => {
    const messages = stepMessages();
    const items = createInRunContextItems();
    items.beginStep({ messages, stepNumber: 0 });
    items.stage(contextItem('project rule'));
    const inserted = {
      role: 'user',
      content: [{ type: 'text', text: 'project rule' }],
    } satisfies ModelMessage;

    // Simulate a model client that retained the previous step's override.
    const retained = items.applyToStep([...messages, inserted]);
    const fresh = items.applyToStep(messages);

    expect(retained).toEqual(fresh);
    expect(retained).toHaveLength(messages.length + 1);
    expect(retained?.[3]).toEqual(inserted);
  });

  it('keeps emission order for items sharing one anchor', () => {
    const messages = stepMessages();
    const items = createInRunContextItems();
    items.beginStep({ messages, stepNumber: 0 });
    items.stage(contextItem('first'));
    items.stage(contextItem('second'));

    const applied = items.applyToStep(messages);

    expect(applied?.slice(-2)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'first' }] },
      { role: 'user', content: [{ type: 'text', text: 'second' }] },
    ]);
  });

  it('appends an item staged with no tool result to the end', () => {
    const messages: Array<ModelMessage> = [{ role: 'user', content: 'hello' }];
    const items = createInRunContextItems();
    items.beginStep({ messages, stepNumber: 0 });
    items.stage(contextItem('no anchor'));

    const applied = items.applyToStep(messages);

    expect(applied).toHaveLength(2);
    expect(applied?.[1]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'no anchor' }],
    });
  });

  it('appends an item whose anchor tool message is absent from a later step', () => {
    const anchorMessages = stepMessages();
    const items = createInRunContextItems();
    items.beginStep({ messages: anchorMessages, stepNumber: 0 });
    items.stage(contextItem('project rule'));

    // A later step whose live messages no longer carry that tool result (e.g.
    // omitted by the replay budget) has nowhere to anchor.
    const laterMessages: Array<ModelMessage> = [
      { role: 'user', content: 'read the file' },
    ];
    const applied = items.applyToStep(laterMessages);

    expect(applied).toHaveLength(2);
    expect(applied?.[1]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'project rule' }],
    });
  });

  it('binds each staged item to the latest beginStep', () => {
    const items = createInRunContextItems();
    const firstStep = stepMessages();
    items.beginStep({ messages: firstStep, stepNumber: 0 });
    items.stage(contextItem('after first'));

    const secondStep: Array<ModelMessage> = [
      ...firstStep,
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-2',
            toolName: 'read',
            input: {},
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-2',
            toolName: 'read',
            output: { type: 'text', value: 'more contents' },
          },
        ],
      },
    ];
    items.beginStep({ messages: secondStep, stepNumber: 1 });
    items.stage(contextItem('after second'));

    expect(
      items.items().map((item) => [item.stepNumber, item.anchorToolCallId]),
    ).toEqual([
      [0, 'call-1'],
      [1, 'call-2'],
    ]);

    const applied = items.applyToStep(secondStep);
    expect(applied?.[3]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'after first' }],
    });
    expect(applied?.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'after second' }],
    });
  });

  it('throws when staging before beginStep', () => {
    const items = createInRunContextItems();

    expect(() => items.stage(contextItem('early'))).toThrow(
      'Cannot stage an in-Run context item before beginStep().',
    );
  });
});
