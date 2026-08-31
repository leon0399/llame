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

/** The exact key set a payload must have — `knowledgeSpaceId` only when the
 *  decoded object carries it, since its absence and presence are both valid
 *  cursor shapes (unscoped vs. space-scoped search). */
function cursorPayloadKeySet(hasSelector: boolean): Array<string> {
  const keys = [
    'offset',
    'path',
    'query',
    'spaceCreatedAt',
    'spaceId',
    'version',
  ];
  if (hasSelector) keys.push('knowledgeSpaceId');
  return keys.sort();
}

function requireCursorString(value: unknown): string {
  if (!isString(value)) throw new KnowledgeSearchCursorError();
  return value;
}

/**
 * Exact-key-set shape validation for the decoded JSON payload — fails closed
 * on any unexpected, missing, or mistyped field, `knowledgeSpaceId` only
 * required when present. Kept separate from cursor construction below: this
 * is "is the untrusted payload well-formed", not yet "is it a valid cursor".
 */
function parseCursorPayload(decoded: unknown): KnowledgeSearchCursorPayload {
  if (!isRecord(decoded)) throw new KnowledgeSearchCursorError();
  const hasSelector = Object.hasOwn(decoded, 'knowledgeSpaceId');
  const keys = Object.keys(decoded).sort();
  const expectedKeys = cursorPayloadKeySet(hasSelector);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new KnowledgeSearchCursorError();
  }
  const knowledgeSpaceId = hasSelector
    ? requireCursorString(decoded.knowledgeSpaceId)
    : undefined;
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
  return {
    version: 1,
    query: decoded.query,
    knowledgeSpaceId,
    spaceCreatedAt: decoded.spaceCreatedAt,
    spaceId: decoded.spaceId,
    path: decoded.path,
    offset: decoded.offset,
  };
}

export function decodeKnowledgeSearchCursor(
  value: string,
): KnowledgeSearchCursor {
  if (
    value.length === 0 ||
    value.length > 4096 ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new KnowledgeSearchCursorError();
  }

  try {
    const payloadJson = Buffer.from(value, 'base64url').toString('utf8');
    const payload = parseCursorPayload(JSON.parse(payloadJson));
    const cursor: KnowledgeSearchCursor = {
      version: 1,
      query: payload.query,
      knowledgeSpaceId: payload.knowledgeSpaceId,
      spaceCreatedAt: new Date(payload.spaceCreatedAt),
      spaceId: payload.spaceId,
      path: payload.path,
      offset: payload.offset,
    };
    if (cursor.spaceCreatedAt.toISOString() !== payload.spaceCreatedAt) {
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
