import { open, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import {
  enforceMigrationLedgerNameConstraint,
  prepareMigrationLedger,
  withMigrationAdvisoryLock,
} from './migration-ledger-upgrade';
import { parseDigestExportDocument } from './recency-digest-export';
import { upgradeRecencyDigest } from './recency-digest-upgrade';

config({ path: '.env.local' });

type UpgradeFilePaths = { exportPath: string; reportPath: string };

function exportAndReportPaths(argv: ReadonlyArray<string>): UpgradeFilePaths {
  let exportPath: string | undefined;
  let reportPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (value === undefined || value.startsWith('--'))
      throw new Error('Invalid upgrade arguments');

    if (flag === '--export' && exportPath === undefined) exportPath = value;
    else if (flag === '--report' && reportPath === undefined)
      reportPath = value;
    else throw new Error('Invalid upgrade arguments');
    index += 1;
  }

  if (!exportPath || !reportPath || resolve(exportPath) === resolve(reportPath))
    throw new Error('Invalid upgrade arguments');

  return { exportPath, reportPath };
}

export async function runRecencyDigestUpgrade(
  argv: ReadonlyArray<string> = process.argv.slice(2),
): Promise<void> {
  const { exportPath, reportPath } = exportAndReportPaths(argv);
  const exportText = await readFile(exportPath, 'utf8');
  const document = parseDigestExportDocument(JSON.parse(exportText));

  if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL is not defined');
  const reportFile = await open(reportPath, 'wx', 0o600);
  const pool = postgres(process.env.POSTGRES_URL, { max: 1 });

  try {
    const migrationsFolder = resolve(__dirname, 'migrations');
    await withMigrationAdvisoryLock(pool, async (tx) => {
      tx.options = pool.options;
      Object.defineProperty(tx, 'begin', {
        value: <T>(callback: (client: typeof tx) => Promise<T>) =>
          tx.savepoint(callback),
      });

      const result = await upgradeRecencyDigest(tx, document, async () => {
        const db = drizzle({ client: tx });
        await prepareMigrationLedger(tx, migrationsFolder);
        await migrate(db, { migrationsFolder });
        await enforceMigrationLedgerNameConstraint(tx);
      });

      await reportFile.writeFile(
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8',
      );
      await reportFile.sync();
    });
  } catch (error) {
    await reportFile.close();
    await pool.end();
    await unlink(reportPath);
    throw error;
  }

  await reportFile.close();
  await pool.end();
}

if (require.main === module) {
  runRecencyDigestUpgrade().catch(() => {
    console.error('Recency digest upgrade failed.');
    process.exitCode = 1;
  });
}
