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
  it('accepts the largest safe sequence number and rejects values outside the valid range', () => {
    const maxSafeSequence = Number.MAX_SAFE_INTEGER;

    expect(parseChatLocator(`chat://${ID}/${maxSafeSequence}`)).toMatchObject({
      kind: 'message',
      messageSeq: maxSafeSequence,
    });
    expect(formatChatLocator(ID, maxSafeSequence)).toBe(
      `chat://${ID.toLowerCase()}/${maxSafeSequence}`,
    );
    expect(() => formatChatLocator('not-a-uuid', 1)).toThrowError(
      new NativeFileError('invalid_path', 'The Chat locator is invalid.'),
    );

    for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => formatChatLocator(ID, sequence)).toThrowError(
        new NativeFileError('invalid_path', 'The Chat locator is invalid.'),
      );
    }
  });

  it.each([
    `chat://${ID}/1/`,
    `chat://${ID}/1\u0000`,
    `chat://${ID}/1?`,
    `chat://${ID}/1#`,
    `chat://${ID}/1%`,
    `chat://${ID}/1:m5%20`,
    `chat://${ID}/1:m5?query`,
    `chat://${ID}/1:m5#fragment`,
  ])('refuses locator containing an invalid suffix %s', (locator) => {
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
