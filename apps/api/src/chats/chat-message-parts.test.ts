import { type Message } from '../db/schema';
import { toRunUserMessage } from './chat-message-parts';

const RETAINED_IMAGE = {
  mediaType: 'image/png',
  width: 1600,
  height: 900,
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
};

/** An owner message row holding the given parts. */
function userMessage(parts: Array<unknown>): Message {
  return {
    id: 'm-user',
    chatId: 'chat-1',
    seq: 1,
    absorbedThroughSeq: null,
    role: 'user',
    senderUserId: 'owner',
    parts,
    attachments: [],
    usage: null,
    inReplyTo: null,
    createdAt: new Date('2026-10-28T00:00:00.000Z'),
    revisedAt: null,
  };
}

describe('toRunUserMessage', () => {
  it('queues no retained bytes, while the stored row keeps them', () => {
    const message = userMessage([
      { type: 'text', text: 'look at @shot.png' },
      {
        type: 'data-context',
        data: {
          v: 1,
          producer: 'prompt-imports',
          form: 'notice',
          text: 'Imported 1 target.',
          payload: {
            imports: [
              {
                locator: 'shot.png',
                outcome: 'imported',
                width: 1600,
                height: 900,
                mediaType: 'image/png',
                retainedMedia: RETAINED_IMAGE,
              },
            ],
          },
        },
      },
    ]);

    const job = toRunUserMessage(message);

    expect(job).toEqual({
      id: 'm-user',
      seq: 1,
      parts: [
        { type: 'text', text: 'look at @shot.png' },
        {
          type: 'data-context',
          data: {
            v: 1,
            producer: 'prompt-imports',
            form: 'notice',
            text: 'Imported 1 target.',
            payload: {
              imports: [
                {
                  locator: 'shot.png',
                  outcome: 'imported',
                  width: 1600,
                  height: 900,
                  mediaType: 'image/png',
                },
              ],
            },
          },
        },
      ],
    });
    expect(JSON.stringify(job)).not.toContain(RETAINED_IMAGE.data);
    expect(JSON.stringify(message)).toContain(RETAINED_IMAGE.data);
  });

  it('keeps a plain user message unchanged', () => {
    const message = userMessage([{ type: 'text', text: 'hello' }]);

    expect(toRunUserMessage(message).parts).toEqual(message.parts);
  });
});
