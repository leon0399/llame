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

/** The exact message shape `applyToStep` inserts for a staged item. */
function insertedMessage(text: string): ModelMessage {
  return { role: 'user', content: [{ type: 'text', text }] };
}

const HISTORY: ModelMessage = { role: 'user', content: 'read the file' };

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

/** One Run step's live messages: the history prefix plus a tool round trip. */
function toolStep(): Array<ModelMessage> {
  return [HISTORY, TOOL_CALL, TOOL_RESULT];
}

describe('createInRunContextItems', () => {
  it('applies nothing when nothing is staged', () => {
    const items = createInRunContextItems();
    items.beginStep([HISTORY]);

    expect(items.applyToStep(toolStep())).toBeUndefined();
  });

  it('inserts a staged item directly after its anchor tool result', () => {
    const following: ModelMessage = { role: 'assistant', content: 'noted' };
    const messages: Array<ModelMessage> = [...toolStep(), following];
    const items = createInRunContextItems();
    // The Run's first step sees chat history only: the boundary sits after it,
    // and only a message past the boundary can anchor an item.
    items.beginStep([HISTORY]);
    items.beginStep(messages);
    items.stage(contextItem('project rule'));

    const applied = items.applyToStep(messages);

    expect(applied).toHaveLength(messages.length + 1);
    expect(applied?.[3]).toEqual(insertedMessage('project rule'));
    // Every original message object is reused by reference in its order; only
    // the item message is new.
    expect(applied?.[0]).toBe(HISTORY);
    expect(applied?.[1]).toBe(TOOL_CALL);
    expect(applied?.[2]).toBe(TOOL_RESULT);
    expect(applied?.[4]).toBe(following);
    // The input array and its messages are untouched.
    expect(messages).toHaveLength(4);
  });

  it('recomputes placement when the step messages already carry the item', () => {
    const messages = toolStep();
    const items = createInRunContextItems();
    items.beginStep([HISTORY]);
    items.beginStep(messages);
    items.stage(contextItem('project rule'));
    const inserted = insertedMessage('project rule');

    // Simulate a model client that retained the previous step's override.
    const retained = items.applyToStep([...messages, inserted]);
    const fresh = items.applyToStep(messages);

    expect(retained).toEqual(fresh);
    expect(retained).toHaveLength(messages.length + 1);
    expect(retained?.[3]).toEqual(inserted);
  });

  it('keeps emission order for items sharing one anchor', () => {
    const messages = toolStep();
    const items = createInRunContextItems();
    items.beginStep([HISTORY]);
    items.beginStep(messages);
    items.stage(contextItem('first'));
    items.stage(contextItem('second'));

    const applied = items.applyToStep(messages);

    expect(applied?.slice(-2)).toEqual([
      insertedMessage('first'),
      insertedMessage('second'),
    ]);
  });

  it('keeps an item staged before any tool result at the Run boundary', () => {
    const items = createInRunContextItems();
    items.beginStep([HISTORY]);
    items.stage(contextItem('no anchor'));

    expect(items.applyToStep([HISTORY])).toEqual([
      HISTORY,
      insertedMessage('no anchor'),
    ]);
    // A later step keeps it directly after the history prefix, where the
    // transcript stores it, instead of moving it behind each new tool result.
    expect(items.applyToStep(toolStep())).toEqual([
      HISTORY,
      insertedMessage('no anchor'),
      TOOL_CALL,
      TOOL_RESULT,
    ]);
  });

  it('appends an item whose anchor tool message is absent from a later step', () => {
    const items = createInRunContextItems();
    items.beginStep([HISTORY]);
    items.beginStep(toolStep());
    items.stage(contextItem('project rule'));

    // A later step whose live messages no longer carry that tool result (e.g.
    // omitted by the replay budget) has nowhere to anchor.
    const laterMessages: Array<ModelMessage> = [HISTORY];
    const applied = items.applyToStep(laterMessages);

    expect(applied).toHaveLength(2);
    expect(applied?.[1]).toEqual(insertedMessage('project rule'));
  });

  it('binds each staged item to the latest beginStep', () => {
    const items = createInRunContextItems();
    items.beginStep([HISTORY]);
    items.beginStep(toolStep());
    items.stage(contextItem('after first'));

    const secondStep: Array<ModelMessage> = [
      ...toolStep(),
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
    items.beginStep(secondStep);
    items.stage(contextItem('after second'));

    const applied = items.applyToStep(secondStep);

    expect(applied?.[3]).toEqual(insertedMessage('after first'));
    expect(applied?.at(-1)).toEqual(insertedMessage('after second'));
  });

  it('never anchors an item to a tool result from before the Run boundary', () => {
    const history: Array<ModelMessage> = [
      { role: 'user', content: 'old question' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-old',
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
            toolCallId: 'call-old',
            toolName: 'read',
            output: { type: 'text', value: 'old contents' },
          },
        ],
      },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'current question' },
    ];
    const items = createInRunContextItems();
    items.beginStep(history);
    items.stage(contextItem('project rule'));

    const applied = items.applyToStep(history);

    // A prior Run's tool result must not become this Run's anchor: the item
    // lands after the last history message, not inside the earlier turn.
    expect(applied).toHaveLength(history.length + 1);
    expect(applied?.at(-1)).toEqual(insertedMessage('project rule'));
    expect(applied?.[3]).toBe(history[3]);
  });

  it('removes its own earlier copy only past the Run boundary', () => {
    const duplicated = 'project rule';
    const history: Array<ModelMessage> = [
      { role: 'user', content: [{ type: 'text', text: duplicated }] },
    ];
    const items = createInRunContextItems();
    items.beginStep(history);
    const step: Array<ModelMessage> = [
      ...history,
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
    items.beginStep(step);
    items.stage(contextItem(duplicated));

    const applied = items.applyToStep(step);

    // A real history message that reads exactly like the item is chat content,
    // not an earlier insertion: it survives by reference, and the item is
    // inserted once, after the tool result it is anchored to.
    expect(applied?.[0]).toBe(history[0]);
    expect(applied?.at(-1)).toEqual(insertedMessage(duplicated));
    expect(
      applied?.filter((message) => isItemCopy(message, duplicated)),
    ).toHaveLength(2);
  });

  it('throws when staging before beginStep', () => {
    const items = createInRunContextItems();

    expect(() => items.stage(contextItem('early'))).toThrow(
      'Cannot stage an in-Run context item before beginStep().',
    );
  });
});

/** Whether `message` is exactly one text part equal to `text`. */
function isItemCopy(message: ModelMessage, text: string): boolean {
  if (message.role !== 'user' || !Array.isArray(message.content)) return false;
  const [part] = message.content;
  return (
    message.content.length === 1 && part?.type === 'text' && part.text === text
  );
}
