import { describe, expect, it } from 'vitest';
import { prepareSendMessagesRequest } from './transport';

describe('prepareSendMessagesRequest', () => {
  it('sends only the last message in the api message envelope', () => {
    const result = prepareSendMessagesRequest({
      messages: [
        { id: 'old', parts: [{ type: 'text', text: 'old' }] },
        { id: 'new', parts: [{ type: 'text', text: 'new' }] },
      ],
    });

    expect(result).toEqual({
      body: {
        message: {
          id: 'new',
          parts: [{ type: 'text', text: 'new' }],
        },
      },
    });
    expect(result).not.toHaveProperty('api');
    expect(result).not.toHaveProperty('credentials');
    expect(result).not.toHaveProperty('fetch');
  });
});
