import { isNumber, isRecord, isString } from '../unknown-record';

export type KnowledgeSearchCursor = {
  readonly version: 1;
  readonly query: string;
  readonly knowledgeSpaceId?: string;
  readonly spaceCreatedAt: Date;
  readonly spaceId: string;
  readonly path: string;
  readonly offset: number;
};

export class KnowledgeSearchCursorError extends Error {
  constructor() {
    super('The Knowledge search cursor is invalid.');
    this.name = 'KnowledgeSearchCursorError';
  }
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type KnowledgeSearchCursorPayload = {
  readonly version: 1;
  readonly query: string;
  readonly knowledgeSpaceId?: string;
  readonly spaceCreatedAt: string;
  readonly spaceId: string;
  readonly path: string;
  readonly offset: number;
};

export function normalizeKnowledgeSearchQuery(query: string): string {
  return query.toLowerCase();
}

export function encodeKnowledgeSearchCursor(
  cursor: KnowledgeSearchCursor,
): string {
  validateCursor(cursor);
  const payload: KnowledgeSearchCursorPayload = {
    version: 1,
    query: cursor.query,
    knowledgeSpaceId: cursor.knowledgeSpaceId,
    spaceCreatedAt: cursor.spaceCreatedAt.toISOString(),
    spaceId: cursor.spaceId,
    path: cursor.path,
    offset: cursor.offset,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeKnowledgeSearchCursor(
  value: string,
): KnowledgeSearchCursor {
  if (
    value.length === 0 ||
    value.length > 4_096 ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new KnowledgeSearchCursorError();
  }

  try {
    const payload = Buffer.from(value, 'base64url').toString('utf8');
    const decoded: unknown = JSON.parse(payload);
    if (!isRecord(decoded)) throw new KnowledgeSearchCursorError();
    const keys = Object.keys(decoded).sort();
    const expectedKeys = [
      'offset',
      'path',
      'query',
      'spaceCreatedAt',
      'spaceId',
      'version',
    ];
    const hasSelector = Object.hasOwn(decoded, 'knowledgeSpaceId');
    if (hasSelector) expectedKeys.push('knowledgeSpaceId');
    expectedKeys.sort();
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index])
    ) {
      throw new KnowledgeSearchCursorError();
    }
    let knowledgeSpaceId: string | undefined;
    if (hasSelector) {
      const candidate = decoded.knowledgeSpaceId;
      if (!isString(candidate)) throw new KnowledgeSearchCursorError();
      knowledgeSpaceId = candidate;
    }
    if (
      decoded.version !== 1 ||
      !isString(decoded.query) ||
      !isString(decoded.spaceCreatedAt) ||
      !isString(decoded.spaceId) ||
      !isString(decoded.path) ||
      !isNumber(decoded.offset)
    ) {
      throw new KnowledgeSearchCursorError();
    }
    const query = decoded.query;
    const spaceCreatedAt = decoded.spaceCreatedAt;
    const spaceId = decoded.spaceId;
    const path = decoded.path;
    const offset = decoded.offset;
    const cursor: KnowledgeSearchCursor = {
      version: 1,
      query,
      knowledgeSpaceId,
      spaceCreatedAt: new Date(spaceCreatedAt),
      spaceId,
      path,
      offset,
    };
    if (cursor.spaceCreatedAt.toISOString() !== spaceCreatedAt) {
      throw new KnowledgeSearchCursorError();
    }
    validateCursor(cursor);
    if (encodeKnowledgeSearchCursor(cursor) !== value) {
      throw new KnowledgeSearchCursorError();
    }
    return cursor;
  } catch (error) {
    if (error instanceof KnowledgeSearchCursorError) throw error;
    throw new KnowledgeSearchCursorError();
  }
}

export function assertKnowledgeSearchCursorBinding(
  cursor: KnowledgeSearchCursor,
  query: string,
  knowledgeSpaceId: string | undefined,
): void {
  if (
    cursor.query !== normalizeKnowledgeSearchQuery(query) ||
    cursor.knowledgeSpaceId !== knowledgeSpaceId
  ) {
    throw new KnowledgeSearchCursorError();
  }
}

function validateCursor(cursor: KnowledgeSearchCursor): void {
  if (
    cursor.version !== 1 ||
    cursor.query.length === 0 ||
    cursor.query !== normalizeKnowledgeSearchQuery(cursor.query) ||
    (cursor.knowledgeSpaceId !== undefined &&
      !UUID_PATTERN.test(cursor.knowledgeSpaceId)) ||
    !UUID_PATTERN.test(cursor.spaceId) ||
    Number.isNaN(cursor.spaceCreatedAt.getTime()) ||
    !Number.isSafeInteger(cursor.offset) ||
    cursor.offset < 0 ||
    !isSafeCursorPath(cursor.path)
  ) {
    throw new KnowledgeSearchCursorError();
  }
}

function isSafeCursorPath(value: string): boolean {
  if (
    value.length === 0 ||
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) ||
    value.includes('\\') ||
    value.startsWith('/')
  ) {
    return false;
  }
  return value.split('/').every((component) => {
    return component.length > 0 && component !== '.' && component !== '..';
  });
}
