import { sql } from 'drizzle-orm';
import { isRecord, isString } from '@workspace/runtime-safety';

import { type Db } from '../db/tenant-db.service';
import { parseArtifactLocatorText } from '../tools/artifacts/locator';

/** One artifact a copied tool part names. */
export type ArtifactCitation = {
  readonly toolName: string;
  readonly seq: number;
};

/**
 * The artifacts the copied tool parts name (tool-result-artifacts D11). A
 * success part carries the locator inside its stored result, and an error part
 * carries it beside the error text; either field is read, so the copy does not
 * depend on which variant produced the part. Everything else in a part —
 * model input, prose, and tool arguments — is never a citation.
 */
export function citedArtifacts(
  parts: ReadonlyArray<unknown>,
): Array<ArtifactCitation> {
  const cited = new Map<string, ArtifactCitation>();
  for (const part of parts) {
    if (!isRecord(part)) continue;
    const type = part['type'];
    if (!isString(type) || !type.startsWith('tool-')) continue;
    const output = part['output'];
    const locators = [
      part['artifact'],
      isRecord(output) ? output['artifact'] : undefined,
    ];
    for (const locator of locators) {
      if (!isString(locator)) continue;
      const parsed = parseArtifactLocatorText(locator);
      if (parsed === undefined) continue;
      cited.set(`${parsed.toolName}-${parsed.seq}`, {
        toolName: parsed.toolName,
        seq: parsed.seq,
      });
    }
  }
  return [...cited.values()];
}

/**
 * Copy the cited artifacts of the source Chat and their parts into the fork,
 * inside the fork's transaction. Both statements are `INSERT … SELECT`, so the
 * bytes never pass through Node. Only the source Chat's rows are eligible, so
 * a copied part cannot pull in an artifact of another Chat.
 */
export async function copyCitedArtifacts(
  tx: Db,
  input: {
    readonly sourceChatId: string;
    readonly targetChatId: string;
    readonly citations: ReadonlyArray<ArtifactCitation>;
  },
): Promise<void> {
  if (input.citations.length === 0) return;
  const pairs = sql.join(
    input.citations.map(
      (citation) => sql`(${citation.toolName}::text, ${citation.seq}::integer)`,
    ),
    sql`, `,
  );
  await tx.execute(sql`
    INSERT INTO tool_artifacts
      (chat_id, seq, tool_name, tool_call_id, run_id, complete, created_at)
    SELECT ${input.targetChatId}::uuid, src.seq, src.tool_name, src.tool_call_id,
      src.run_id, src.complete, src.created_at
    FROM tool_artifacts src
    WHERE src.chat_id = ${input.sourceChatId}::uuid
      AND (src.tool_name, src.seq) IN (${pairs})
  `);
  // The new artifact rows share their locator (tool name and seq) with the
  // source, so the join pairs each part with its fork's own artifact id.
  await tx.execute(sql`
    INSERT INTO tool_artifact_parts
      (artifact_id, name, content_type, content, sha256, byte_size, line_count, findings)
    SELECT target.id, part.name, part.content_type, part.content, part.sha256,
      part.byte_size, part.line_count, part.findings
    FROM tool_artifact_parts part
    INNER JOIN tool_artifacts src ON src.id = part.artifact_id
    INNER JOIN tool_artifacts target
      ON target.chat_id = ${input.targetChatId}::uuid
      AND target.tool_name = src.tool_name
      AND target.seq = src.seq
    WHERE src.chat_id = ${input.sourceChatId}::uuid
  `);
}
