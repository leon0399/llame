import { drizzle } from 'drizzle-orm/postgres-js';
import { NativeFileError } from '@workspace/native-file-tools';
import { describe, expect, it, vi } from 'vitest';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { formatChatLocator, parseChatLocator } from '../chats/chat-locator';
import { parseMessageRequest } from './chat-read-utils';
import { readChatResource } from './chat-read';
import { type ToolContext } from './types';

const ID = 'A0B1C2D3-E4F5-4678-8ABC-0123456789AB';
const LOWER_ID = ID.toLowerCase();

function context() {
  const db = drizzle.mock();
  const runAs = vi.fn<(owner: string) => void>();

  const run: TenantRunner['runAs'] = <T>(
    owner: string,
    callback: (tx: Db) => Promise<T>,
  ) => {
    runAs(owner);

    return callback(db);
  };

  return {
    value: {
      userId: 'owner',
      chatId: 'chat',
      tenantDb: { runAs: run },
      configuredCredentials: [],
    } satisfies ToolContext,
    runAs,
  };
}

describe('Chat message selector grammar', () => {
  it('anchors both tail and range forms and rejects leading or trailing junk', () => {
    for (const selector of ['junk-m3', '-m3junk', 'xm1', 'm1x']) {
      expect(() => parseMessageRequest(selector)).toThrow('invalid');
    }
  });

  it('parses multi-digit sequence bounds, forward windows, counts, and tails', () => {
    expect(parseMessageRequest(':M12-34')).toEqual({
      kind: 'range',
      start: 12,
      end: 34,
    });
    expect(parseMessageRequest('m12-M34')).toEqual({
      kind: 'range',
      start: 12,
      end: 34,
    });
    expect(parseMessageRequest('m12-12')).toEqual({
      kind: 'range',
      start: 12,
      end: 12,
    });
    expect(parseMessageRequest('M12')).toEqual({
      kind: 'range',
      start: 12,
      end: 12,
    });
    expect(parseMessageRequest('M12-')).toEqual({ kind: 'forward', start: 12 });
    expect(parseMessageRequest('m12+3')).toEqual({
      kind: 'range',
      start: 12,
      end: 14,
    });
    expect(parseMessageRequest('m12+34')).toEqual({
      kind: 'range',
      start: 12,
      end: 45,
    });
    expect(parseMessageRequest('-M12')).toEqual({ kind: 'tail', count: 12 });
    expect(parseMessageRequest(':-m12')).toEqual({ kind: 'tail', count: 12 });
  });

  it.each([
    'M-1',
    'M0',
    'M1.5',
    'M9007199254740992',
    'M1-0',
    'M3-2',
    'M9007199254740991+2',
    'M1+0',
    '-M0',
    '-M9007199254740992',
    'L12',
  ])('rejects invalid or unsupported message selector %s', (selector) => {
    expect(() => parseMessageRequest(selector)).toThrow('invalid');
  });

  it('returns a typed invalid-selector response for L through the exported reader', async () => {
    const fixture = context();
    await expect(
      readChatResource(fixture.value, 'read', `chat://${ID}:L12`),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'invalid_selector',
    });
  });
});

describe('Chat locator normalization and refusal', () => {
  it('normalizes UUID case and sequence representation in parsed locators', () => {
    expect(parseChatLocator(`CHAT://${ID}/12`)).toEqual({
      kind: 'message',
      chatId: LOWER_ID,
      messageSeq: 12,
      locator: `chat://${LOWER_ID}/12`,
    });
    expect(formatChatLocator(ID, 12)).toBe(`chat://${LOWER_ID}/12`);
  });

  it.each([
    `file://${ID}`,
    `chat://${ID}//1`,
    `chat://${ID}/01`,
    `chat://${ID}/1.5`,
    `chat://${ID}/1e2`,
    `chat://${ID}/-1`,
    `chat://${ID}/9007199254740992`,
  ])('rejects unsupported locator form %s', (locator) => {
    expect(() => parseChatLocator(locator)).toThrow(NativeFileError);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])(
    'refuses a message sequence that cannot be formatted safely: %s',
    (sequence) => {
      expect(() => formatChatLocator(ID, sequence)).toThrow(NativeFileError);
    },
  );

  it('refuses an invalid UUID when formatting a Chat address', () => {
    expect(() => formatChatLocator('not-a-uuid')).toThrow(NativeFileError);
  });

  it('refuses message mutation through the exported reader with its exact contract', async () => {
    const fixture = context();
    await expect(
      readChatResource(fixture.value, 'write', `chat://${ID}/12`),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'unsupported_operation',
    });
    expect(fixture.runAs).not.toHaveBeenCalled();
  });
});
