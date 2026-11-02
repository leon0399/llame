import { and, asc, eq, sql } from 'drizzle-orm';

import { chats, toolArtifactParts, toolArtifacts } from '../../db/schema';
import { type Db } from '../../db/tenant-db.service';

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

export type StoredArtifact = {
  readonly id: string;
  readonly seq: number;
  readonly toolName: string;
  readonly complete: boolean;
  readonly createdAt: Date;
};

export type StoredPart = ArtifactPartSummary & {
  readonly contentType: string;
  readonly content: Buffer;
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

  async insertArtifact(artifact: NewArtifact): Promise<string> {
    const [row] = await this.db
      .insert(toolArtifacts)
      .values(artifact)
      .returning({ id: toolArtifacts.id });
    return row.id;
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

  async find(
    chatId: string,
    toolName: string,
    seq: number,
  ): Promise<StoredArtifact | undefined> {
    const [row] = await this.db
      .select({
        id: toolArtifacts.id,
        seq: toolArtifacts.seq,
        toolName: toolArtifacts.toolName,
        complete: toolArtifacts.complete,
        createdAt: toolArtifacts.createdAt,
      })
      .from(toolArtifacts)
      .where(
        and(
          eq(toolArtifacts.chatId, chatId),
          eq(toolArtifacts.toolName, toolName),
          eq(toolArtifacts.seq, seq),
        ),
      );
    return row;
  }

  async listParts(artifactId: string): Promise<Array<ArtifactPartSummary>> {
    return this.db
      .select({
        name: toolArtifactParts.name,
        lineCount: toolArtifactParts.lineCount,
        byteSize: toolArtifactParts.byteSize,
      })
      .from(toolArtifactParts)
      .where(eq(toolArtifactParts.artifactId, artifactId))
      .orderBy(asc(toolArtifactParts.name));
  }

  /** The part without its bytes, for a reader that must only list. */
  async findPart(
    artifactId: string,
    name: string,
  ): Promise<StoredPart | undefined> {
    const [row] = await this.db
      .select({
        name: toolArtifactParts.name,
        contentType: toolArtifactParts.contentType,
        content: toolArtifactParts.content,
        lineCount: toolArtifactParts.lineCount,
        byteSize: toolArtifactParts.byteSize,
        findings: toolArtifactParts.findings,
      })
      .from(toolArtifactParts)
      .where(
        and(
          eq(toolArtifactParts.artifactId, artifactId),
          eq(toolArtifactParts.name, name),
        ),
      );
    return row;
  }
}
