import {
  NativeFileError,
  parsePathScheme,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';

export const CHAT_SCHEME = 'chat';
const ROOT = 'chat://';
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;
const POSITIVE_SAFE_INTEGER = /^[1-9]\d*$/u;

export type ChatLocator =
  | {
      readonly kind: 'collection';
      readonly locator: 'chat://';
      readonly selector?: string;
    }
  | {
      readonly kind: 'index';
      readonly chatId: string;
      readonly locator: string;
      readonly selector?: string;
    }
  | {
      readonly kind: 'message';
      readonly chatId: string;
      readonly messageSeq: number;
      readonly locator: string;
      readonly selector?: string;
    };

export function formatChatLocator(chatId: string, messageSeq?: number): string {
  if (
    !UUID.test(chatId) ||
    (messageSeq !== undefined &&
      (!Number.isSafeInteger(messageSeq) || messageSeq < 1))
  ) {
    throw invalidPath();
  }

  const base = `${ROOT}${chatId.toLowerCase()}`;

  return messageSeq === undefined ? base : `${base}/${messageSeq}`;
}

export function parseChatLocator(locator: string): ChatLocator {
  if (locator.includes('\0') || /[%?#]/u.test(locator)) throw invalidPath();
  const split = splitSelectorSuffix(locator);
  const scheme = parsePathScheme(split.path);

  if (scheme?.scheme !== CHAT_SCHEME) throw invalidPath();
  const selector = split.selector;
  const suffix = selector === undefined ? {} : { selector };
  const rest = scheme.rest;

  if (rest === '' || rest === '/')
    return { kind: 'collection', locator: ROOT, ...suffix };
  const segments = rest.split('/');

  if (segments.length > 2 || !UUID.test(segments[0] ?? '')) throw invalidPath();
  const chatId = segments[0].toLowerCase();
  const seqPart = segments[1];

  if (seqPart === undefined)
    return {
      kind: 'index',
      chatId,
      locator: formatChatLocator(chatId),
      ...suffix,
    };

  if (!POSITIVE_SAFE_INTEGER.test(seqPart)) throw invalidPath();
  const messageSeq = Number(seqPart);

  if (!Number.isSafeInteger(messageSeq)) throw invalidPath();

  return {
    kind: 'message',
    chatId,
    messageSeq,
    locator: formatChatLocator(chatId, messageSeq),
    ...suffix,
  };
}

function invalidPath(): NativeFileError {
  return new NativeFileError('invalid_path', 'The Chat locator is invalid.');
}
