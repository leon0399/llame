import { NativeFileError } from '@workspace/native-file-tools';
import { describe, expect, it } from 'vitest';
import { formatChatLocator, parseChatLocator } from './chat-locator';

const ID = 'A0B1C2D3-E4F5-4678-8ABC-0123456789AB';

describe('Chat locator', () => {
  it('normalizes UUIDs and safe positive sequence numbers', () => {
    expect(parseChatLocator(`CHAT://${ID}/1`)).toEqual({
      kind: 'message',
      chatId: ID.toLowerCase(),
      messageSeq: 1,
      locator: `chat://${ID.toLowerCase()}` + '/1',
    });
    expect(formatChatLocator(ID, 2)).toBe(`chat://${ID.toLowerCase()}/2`);
  });

  it('preserves selector spelling while separating it from the resource address', () => {
    expect(parseChatLocator(`chat://${ID}/1:m5+2`)).toMatchObject({
      kind: 'message',
      selector: 'm5+2',
    });
  });

  it.each([
    'chat://bad',
    `chat://${ID}/0`,
    `chat://${ID}/-1`,
    `chat://${ID}/1/extra`,
    `chat://${ID}?query`,
    `chat://${ID}#fragment`,
    `chat://${ID}/1%32`,
    `chat://${ID}/9007199254740992`,
  ])('refuses malformed locator %s', (locator) => {
    expect(() => parseChatLocator(locator)).toThrowError(
      new NativeFileError('invalid_path', 'The Chat locator is invalid.'),
    );
  });

  it('recognizes collection and index addresses', () => {
    expect(parseChatLocator('chat://')).toMatchObject({
      kind: 'collection',
      locator: 'chat://',
    });
    expect(parseChatLocator(`chat://${ID}`)).toMatchObject({
      kind: 'index',
      chatId: ID.toLowerCase(),
    });
    expect(parseChatLocator('chat:///')).toMatchObject({
      kind: 'collection',
      locator: 'chat://',
    });
  });
});
