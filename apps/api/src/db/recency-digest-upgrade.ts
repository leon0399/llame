import type { Sql } from 'postgres';
import type {
  DigestExportDocument,
  DigestExportRecord,
} from './recency-digest-export';
import {
  importChat,
  recordOmission,
  type LegacyChat,
  type ImportOmission,
} from './recency-digest-upgrade-chat';

export const RECENCY_DIGEST_UPGRADE_WITNESS =
  'app.recency_digest_upgrade_witness';

const WITNESS_VALUE = 'v1';

type InventoryChat = { id: string; owner_user_id: string };

export type RecencyDigestUpgradeReport = {
  inventoryChats: number;
  importedChats: number;
  omittedChats: number;
  omissions: ReadonlyArray<ImportOmission>;
};

export async function establishFreshRecencyDigestWitness(
  connection: Sql,
): Promise<boolean> {
  const [catalog] = await connection<Array<{ table_name: string | null }>>`
    select to_regclass('chats')::text as table_name
  `;

  if (catalog?.table_name !== null && catalog?.table_name !== undefined)
    return false;
  await setWitness(connection);

  return true;
}

async function setWitness(connection: Sql): Promise<void> {
  await connection`select set_config(${RECENCY_DIGEST_UPGRADE_WITNESS}, ${WITNESS_VALUE}, true)`;

  const [witness] = await connection<Array<{ value: string | null }>>`
    select current_setting(${RECENCY_DIGEST_UPGRADE_WITNESS}, true) as value
  `;

  if (witness?.value !== WITNESS_VALUE)
    throw new Error('Digest migration witness could not be established');
}

async function resetTenantIdentity(connection: Sql): Promise<void> {
  await connection`select set_config('app.current_user_id', '', true)`;

  const [identity] = await connection<Array<{ value: string | null }>>`
    select current_setting('app.current_user_id', true) as value
  `;

  if (identity?.value !== '')
    throw new Error('Tenant identity was not reset before migrations');
}

type InventoryImport = {
  connection: Sql;
  inventory: Array<InventoryChat>;
  records: ReadonlyMap<string, DigestExportRecord>;
  omissions: Array<ImportOmission>;
};

async function importOwnedDestination(
  input: InventoryImport,
  destination: InventoryChat,
): Promise<boolean | undefined> {
  const { connection, records, omissions } = input;
  const ownerId = destination.owner_user_id;

  const [chat] = await connection<Array<LegacyChat>>`
    select id::text, owner_user_id, recency_digest_baseline, recency_digest_told, recency_digest_rebaked_from
    from chats where id = ${destination.id}::uuid and owner_user_id = ${ownerId}
  `;

  if (!chat) {
    recordOmission(
      omissions,
      destination.id,
      'all',
      'owner_scoped_destination_unavailable',
    );

    return false;
  }

  if (
    chat.recency_digest_baseline === null &&
    chat.recency_digest_told === null &&
    chat.recency_digest_rebaked_from === null
  )
    return undefined;

  return importChat({
    connection,
    ownerId,
    chat,
    record: records.get(chat.id),
    omissions,
  });
}

async function importOwnerInventory(input: InventoryImport) {
  const chatsByOwner = new Map<string, Array<InventoryChat>>();

  for (const chat of input.inventory) {
    const chats = chatsByOwner.get(chat.owner_user_id) ?? [];
    chats.push(chat);
    chatsByOwner.set(chat.owner_user_id, chats);
  }

  let importedChats = 0;
  let omittedChats = 0;

  for (const [ownerId, destinations] of chatsByOwner) {
    await input.connection`select set_config('app.current_user_id', ${ownerId}, true)`;

    for (const destination of destinations) {
      const imported = await importOwnedDestination(input, destination);

      if (imported === true) importedChats += 1;
      else if (imported === false) omittedChats += 1;
    }
  }

  return { importedChats, omittedChats };
}

async function importLegacyInventory(
  connection: Sql,
  document: DigestExportDocument,
): Promise<RecencyDigestUpgradeReport> {
  await connection.unsafe('lock table chats in access exclusive mode');
  await connection.unsafe('alter table chats no force row level security');

  const inventory = await connection<Array<InventoryChat>>`
    select id::text, owner_user_id from chats order by owner_user_id, id
  `;

  await connection.unsafe('alter table chats force row level security');

  const records = new Map(
    document.records.map((record) => [record.chatId, record]),
  );

  if (records.size !== document.records.length)
    throw new Error('Duplicate destination Chat in private export');
  const omissions: Array<ImportOmission> = [];
  const inventoryIds = new Set(inventory.map(({ id }) => id));

  for (const record of document.records)
    if (!inventoryIds.has(record.chatId))
      recordOmission(
        omissions,
        record.chatId,
        'identity',
        'destination_chat_missing',
      );

  const { importedChats, omittedChats } = await importOwnerInventory({
    connection,
    inventory,
    records,
    omissions,
  });

  await resetTenantIdentity(connection);

  return {
    inventoryChats: inventory.length,
    importedChats,
    omittedChats,
    omissions,
  };
}

async function legacyDigestColumnCount(connection: Sql): Promise<number> {
  const [row] = await connection<Array<{ count: number }>>`
    select count(*)::int as count from information_schema.columns
    where table_schema = current_schema() and table_name = 'chats'
      and column_name = any(${['recency_digest_baseline', 'recency_digest_told', 'recency_digest_rebaked_from']})
  `;

  return row?.count ?? 0;
}

export async function upgradeRecencyDigest(
  connection: Sql,
  document: DigestExportDocument,
  pendingMigrations: () => Promise<void>,
): Promise<RecencyDigestUpgradeReport> {
  const [catalog] = await connection<Array<{ table_name: string | null }>>`
    select to_regclass('chats')::text as table_name
  `;

  if (catalog?.table_name === null || catalog?.table_name === undefined) {
    if (document.records.length !== 0)
      throw new Error('Fresh database cannot consume a populated export');
    await setWitness(connection);
    await resetTenantIdentity(connection);
    await pendingMigrations();

    return {
      inventoryChats: 0,
      importedChats: 0,
      omittedChats: 0,
      omissions: [],
    };
  }

  const oldColumnCount = await legacyDigestColumnCount(connection);

  if (oldColumnCount === 0) {
    await resetTenantIdentity(connection);
    await pendingMigrations();

    return {
      inventoryChats: 0,
      importedChats: 0,
      omittedChats: 0,
      omissions: [],
    };
  }

  if (oldColumnCount !== 3)
    throw new Error('Legacy digest schema is incomplete');
  const report = await importLegacyInventory(connection, document);
  await setWitness(connection);
  await pendingMigrations();

  return report;
}
