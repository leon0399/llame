import { closeSync, openSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { chats, users, type Chat } from '../db/schema';
import { PersonalizationService } from '../personalization/personalization.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import type { PromptWebSearchInput } from '../instance-config/prompt-loader';
import { webSearchEngineItems } from '../tools/web-search/catalog';
import type { TenantDbService, Db } from '../db/tenant-db.service';
import type {
  PromptUserInput,
  SystemModelCatalogEntry,
} from '../models/model-catalog';
import {
  RECENCY_DIGEST_EXPORT_VERSION,
  type RecencyDigestExportDocument,
  type RecencyDigestExportRecord,
} from './recency-digest-export-proof';
import { reconstructDigestAttempts } from './recency-digest-export-attempts';
import { buildRecencyDigestExportRecord } from './recency-digest-export-record';

async function exportChatRecord(input: {
  tx: Db;
  ownerId: string;
  chat: Chat;
  models: ReadonlyArray<SystemModelCatalogEntry>;
  user: PromptUserInput | undefined;
  webSearch: PromptWebSearchInput | undefined;
}): Promise<RecencyDigestExportRecord> {
  const attempts = await reconstructDigestAttempts(input);

  return buildRecencyDigestExportRecord({
    ownerId: input.ownerId,
    chat: input.chat,
    attempts,
  });
}

export function writePrivateExportDocument(
  path: string,
  document: RecencyDigestExportDocument,
): void {
  const output = JSON.stringify(document);
  const descriptor = openSync(path, 'wx', 0o600);

  try {
    writeFileSync(descriptor, output, { encoding: 'utf8' });
  } finally {
    closeSync(descriptor);
  }
}

async function exportOwnerRecords(input: {
  tenantDb: Pick<TenantDbService, 'runAs'>;
  ownerId: string;
  models: ReadonlyArray<SystemModelCatalogEntry>;
  user: PromptUserInput | undefined;
  webSearch: PromptWebSearchInput | undefined;
}): Promise<Array<RecencyDigestExportRecord>> {
  return input.tenantDb.runAs(input.ownerId, async (tx) => {
    const ownerChats = await tx
      .select()
      .from(chats)
      .where(eq(chats.ownerUserId, input.ownerId));

    const records: Array<RecencyDigestExportRecord> = [];

    for (const chat of ownerChats) {
      if (chat.ownerUserId !== input.ownerId) continue;
      records.push(
        await exportChatRecord({
          tx,
          ownerId: input.ownerId,
          chat,
          models: input.models,
          user: input.user,
          webSearch: input.webSearch,
        }),
      );
    }

    return records;
  });
}

type ExportOwner = { id: string };

async function collectExportRecords(input: {
  tenantDb: Pick<TenantDbService, 'runAs'>;
  personalization: PersonalizationService;
  models: ReadonlyArray<SystemModelCatalogEntry>;
  owners: ReadonlyArray<ExportOwner>;
  webSearch: PromptWebSearchInput | undefined;
}): Promise<Array<RecencyDigestExportRecord>> {
  const records: Array<RecencyDigestExportRecord> = [];

  for (const { id: ownerId } of input.owners) {
    const user = await input.personalization.resolvePromptUser(ownerId);

    const ownerRecords = await exportOwnerRecords({
      tenantDb: input.tenantDb,
      ownerId,
      models: input.models,
      user,
      webSearch: input.webSearch,
    });

    for (const record of ownerRecords) records.push(record);
  }

  return records;
}

function countExportOmissions(
  records: ReadonlyArray<RecencyDigestExportRecord>,
): number {
  return records.reduce(
    (count, record) =>
      count +
      record.omissions.length +
      record.baseline.omissions.length +
      record.comparison.omissions.length,
    0,
  );
}

export async function exportRecencyDigest(input: {
  tenantDb: Pick<TenantDbService, 'runAs' | 'runAsPublic'>;
  instanceConfig: InstanceConfigService;
  personalization: PersonalizationService;
  outPath: string;
  exportedAt?: Date;
}): Promise<{ owners: number; chats: number; omissions: number }> {
  const ownerRows = await input.tenantDb.runAsPublic((tx: Db) =>
    tx.select({ id: users.id }).from(users),
  );

  const webSearch = webSearchEngineItems(input.instanceConfig.config.webSearch);

  const records = await collectExportRecords({
    tenantDb: input.tenantDb,
    personalization: input.personalization,
    models: input.instanceConfig.config.models,
    owners: ownerRows,
    webSearch,
  });

  const document: RecencyDigestExportDocument = {
    version: RECENCY_DIGEST_EXPORT_VERSION,
    exporter: 'recency-digest-export/1',
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    records,
  };

  writePrivateExportDocument(input.outPath, document);

  return {
    owners: ownerRows.length,
    chats: records.length,
    omissions: countExportOmissions(records),
  };
}
