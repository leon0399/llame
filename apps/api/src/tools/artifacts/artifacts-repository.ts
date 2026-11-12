import { and, asc, eq, sql } from 'drizzle-orm';

import { chats, toolArtifactParts, toolArtifacts } from '../../db/schema';
import { type Db } from '../../db/tenant-db.service';
import { type ArtifactLocator } from './locator';

/** One artifact as the Chat list shows it. */
export type ArtifactSummary = {
  readonly seq: number;
  readonly toolName: string;
  readonly createdAt: Date;
  readonly lineCount: number;
  readonly byteSize: number;
};

/** One part as a `bash` artifact's stream list shows it. */
export type ArtifactPartSummary = {
  readonly name: string;
  readonly lineCount: number;
  readonly byteSize: number;
};

/** One artifact's parts, with the creation time both lists show. */
export type ArtifactParts = {
  readonly createdAt: Date;
  readonly parts: ReadonlyArray<ArtifactPartSummary>;
};

export type StoredPart = {
  readonly contentType: string;
  readonly content: Buffer;
  readonly lineCount: number;
  /** The read-time finding record (`grep` and `web_search` only). */
  readonly findings: unknown;
};

export type NewArtifact = {
  readonly chatId: string;
  readonly seq: number;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly runId: string;
  readonly complete: boolean;
};

/**
 * One part as a host-file reconcile reads it: the file's identity and the
 * stored size and time, without the bytes (tool-result-artifacts D10).
 */
export type ChatPartFile = {
  readonly artifactId: string;
  readonly toolName: string;
  readonly seq: number;
  readonly createdAt: Date;
  readonly name: string;
  readonly contentType: string;
  readonly byteSize: number;
};

export type NewArtifactPart = {
  readonly name: string;
  readonly contentType: string;
  readonly content: Buffer;
  readonly sha256: string;
  readonly byteSize: number;
  readonly lineCount: number;
  readonly findings: unknown;
};

/**
 * Owner-scoped access to the artifact tables (tool-result-artifacts D1). RLS is
 * the isolation guarantee; every query also names its Chat as a seatbelt, so a
 * locator from another Chat of the same owner resolves to nothing.
 */
export class ArtifactsRepository {
  constructor(private readonly db: Db) {}

  /**
   * The Chat's next artifact number. It runs in its own short transaction, so
   * the Chat row lock is not held across the part insert; a failed write
   * therefore leaves a gap in the numbers, which D1 accepts.
   */
  async nextSeq(
    chatId: string,
    ownerUserId: string,
  ): Promise<number | undefined> {
    const [row] = await this.db
      .update(chats)
      .set({ artifactSeq: sql`${chats.artifactSeq} + 1` })
      .where(and(eq(chats.id, chatId), eq(chats.ownerUserId, ownerUserId)))
      .returning({ seq: chats.artifactSeq });

    return row?.seq;
  }

  async insertArtifact(
    artifact: NewArtifact,
  ): Promise<{ id: string; createdAt: Date }> {
    const [row] = await this.db
      .insert(toolArtifacts)
      .values(artifact)
      .returning({ id: toolArtifacts.id, createdAt: toolArtifacts.createdAt });

    return row;
  }

  /** Every part of one artifact, inserted in the caller's transaction. */
  async insertParts(
    artifactId: string,
    parts: ReadonlyArray<NewArtifactPart>,
  ): Promise<void> {
    await this.db
      .insert(toolArtifactParts)
      .values(parts.map((part) => ({ ...part, artifactId })));
  }

  /** The Chat's artifacts, oldest first, with their size in lines and bytes. */
  async listChat(chatId: string): Promise<Array<ArtifactSummary>> {
    return this.db
      .select({
        seq: toolArtifacts.seq,
        toolName: toolArtifacts.toolName,
        createdAt: toolArtifacts.createdAt,
        lineCount:
          sql<number>`coalesce(sum(${toolArtifactParts.lineCount}), 0)`.mapWith(
            Number,
          ),
        byteSize:
          sql<number>`coalesce(sum(${toolArtifactParts.byteSize}), 0)`.mapWith(
            Number,
          ),
      })
      .from(toolArtifacts)
      .leftJoin(
        toolArtifactParts,
        eq(toolArtifactParts.artifactId, toolArtifacts.id),
      )
      .where(eq(toolArtifacts.chatId, chatId))
      .groupBy(toolArtifacts.id)
      .orderBy(asc(toolArtifacts.seq));
  }

  /** One artifact's parts and creation time, or undefined for a missing one. */
  async findParts(
    chatId: string,
    toolName: string,
    seq: number,
  ): Promise<ArtifactParts | undefined> {
    const rows = await this.db
      .select({
        createdAt: toolArtifacts.createdAt,
        name: toolArtifactParts.name,
        lineCount: toolArtifactParts.lineCount,
        byteSize: toolArtifactParts.byteSize,
      })
      .from(toolArtifacts)
      .innerJoin(
        toolArtifactParts,
        eq(toolArtifactParts.artifactId, toolArtifacts.id),
      )
      .where(
        and(
          eq(toolArtifacts.chatId, chatId),
          eq(toolArtifacts.toolName, toolName),
          eq(toolArtifacts.seq, seq),
        ),
      )
      .orderBy(asc(toolArtifactParts.name));

    const [first] = rows;

    if (first === undefined) return undefined;

    return {
      createdAt: first.createdAt,
      parts: rows.map(({ name, lineCount, byteSize }) => ({
        name,
        lineCount,
        byteSize,
      })),
    };
  }

  /** One named part of one artifact, with its bytes, in one joined query. */
  async readPart(
    chatId: string,
    toolName: string,
    seq: number,
    name: string,
  ): Promise<StoredPart | undefined> {
    const [row] = await this.db
      .select({
        contentType: toolArtifactParts.contentType,
        content: toolArtifactParts.content,
        lineCount: toolArtifactParts.lineCount,
        findings: toolArtifactParts.findings,
      })
      .from(toolArtifactParts)
      .innerJoin(
        toolArtifacts,
        eq(toolArtifacts.id, toolArtifactParts.artifactId),
      )
      .where(
        and(
          eq(toolArtifacts.chatId, chatId),
          eq(toolArtifacts.toolName, toolName),
          eq(toolArtifacts.seq, seq),
          eq(toolArtifactParts.name, name),
        ),
      );

    return row;
  }

  /** One artifact part's last bounded bytes, without transferring its prefix. */
  async readPartTail(
    chatId: string,
    locator: ArtifactLocator & { readonly part: string },
    maxBytes: number,
  ): Promise<Buffer | undefined> {
    const byteLimit = Math.max(0, Math.min(maxBytes, 8000));

    const [row] = await this.db
      .select({
        content: sql<Buffer>`substring(
          ${toolArtifactParts.content} from
            greatest(
              octet_length(${toolArtifactParts.content}) - ${byteLimit} + 1,
              1
            )
          for least(octet_length(${toolArtifactParts.content}), ${byteLimit})
        )`,
      })
      .from(toolArtifactParts)
      .innerJoin(
        toolArtifacts,
        eq(toolArtifacts.id, toolArtifactParts.artifactId),
      )
      .where(
        and(
          eq(toolArtifacts.chatId, chatId),
          eq(toolArtifacts.toolName, locator.toolName),
          eq(toolArtifacts.seq, locator.seq),
          eq(toolArtifactParts.name, locator.part),
        ),
      );

    return row?.content;
  }

  /**
   * Every part of the Chat's artifacts with its size and time but no bytes, so
   * a reconcile fetches only the content of a file it must rewrite (D10).
   */
  async listChatPartFiles(chatId: string): Promise<Array<ChatPartFile>> {
    return this.db
      .select({
        artifactId: toolArtifacts.id,
        toolName: toolArtifacts.toolName,
        seq: toolArtifacts.seq,
        createdAt: toolArtifacts.createdAt,
        name: toolArtifactParts.name,
        contentType: toolArtifactParts.contentType,
        byteSize: toolArtifactParts.byteSize,
      })
      .from(toolArtifacts)
      .innerJoin(
        toolArtifactParts,
        eq(toolArtifactParts.artifactId, toolArtifacts.id),
      )
      .where(eq(toolArtifacts.chatId, chatId))
      .orderBy(asc(toolArtifacts.seq), asc(toolArtifactParts.name));
  }

  /**
   * One part's bytes only, for the reconcile's repair (D10): the findings and
   * the reader's counts are not needed there. The Chat filter keeps the
   * seatbelt every query of this class carries, so a stray artifact id from
   * another Chat resolves to nothing.
   */
  async findPartContent(
    chatId: string,
    artifactId: string,
    name: string,
  ): Promise<Array<{ readonly content: Buffer }>> {
    return this.db
      .select({ content: toolArtifactParts.content })
      .from(toolArtifactParts)
      .innerJoin(
        toolArtifacts,
        eq(toolArtifacts.id, toolArtifactParts.artifactId),
      )
      .where(
        and(
          eq(toolArtifacts.chatId, chatId),
          eq(toolArtifactParts.artifactId, artifactId),
          eq(toolArtifactParts.name, name),
        ),
      );
  }
}
