import { isRecord, isString } from '@workspace/runtime-safety';

export type KnowledgeSpaceCursor = {
  createdAt: Date;
  id: string;
};

export class KnowledgeSpaceCursorError extends Error {
  constructor() {
    super('The Knowledge Space cursor is invalid.');
    this.name = 'KnowledgeSpaceCursorError';
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab0-9][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export function encodeKnowledgeSpaceCursor(
  cursor: KnowledgeSpaceCursor,
): string {
  const createdAt = toCanonicalDate(cursor.createdAt);
  const id = toCanonicalUuid(cursor.id);
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString(
    'base64url',
  );
}

export function decodeKnowledgeSpaceCursor(
  value: string,
): KnowledgeSpaceCursor {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new KnowledgeSpaceCursorError();
  }

  try {
    const payload = Buffer.from(value, 'base64url').toString('utf8');
    const decoded: unknown = JSON.parse(payload);
    if (!isRecord(decoded)) throw new KnowledgeSpaceCursorError();
    if (
      Object.keys(decoded).length !== 2 ||
      !isString(decoded.createdAt) ||
      !isString(decoded.id)
    ) {
      throw new KnowledgeSpaceCursorError();
    }

    const cursor = {
      createdAt: new Date(toCanonicalDate(decoded.createdAt)),
      id: toCanonicalUuid(decoded.id),
    };
    if (encodeKnowledgeSpaceCursor(cursor) !== value) {
      throw new KnowledgeSpaceCursorError();
    }
    return cursor;
  } catch (error) {
    if (error instanceof KnowledgeSpaceCursorError) throw error;
    throw new KnowledgeSpaceCursorError();
  }
}

function toCanonicalDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new KnowledgeSpaceCursorError();
  const canonical = date.toISOString();
  if (!(value instanceof Date) && value !== canonical) {
    throw new KnowledgeSpaceCursorError();
  }
  return canonical;
}

function toCanonicalUuid(value: string): string {
  if (value !== value.toLowerCase() || !UUID_PATTERN.test(value)) {
    throw new KnowledgeSpaceCursorError();
  }
  return value;
}
