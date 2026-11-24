import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';

import { TenantDbService } from '../db/tenant-db.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { PersonalizationService } from '../personalization/personalization.service';
import { RecencyDigestExportModule } from './recency-digest-export.module';
import { exportRecencyDigest } from './recency-digest-export';

config({ path: '.env.local' });

// Nest's logger stays disabled: bootstrap errors can quote config values. This
// shell prints only fixed usage, failure, and count lines, never the error.
async function main(args: ReadonlyArray<string>): Promise<void> {
  const outIndex = args.indexOf('--out');
  const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;

  if (!outPath || outPath.startsWith('--')) {
    process.stderr.write(
      'Usage: recency-digest-export --out <private-file-path>\n',
    );
    throw new Error('Invalid command arguments');
  }

  const app = await NestFactory.createApplicationContext(
    RecencyDigestExportModule,
    { logger: false, abortOnError: false },
  );

  try {
    const result = await exportRecencyDigest({
      tenantDb: app.get(TenantDbService),
      instanceConfig: app.get(InstanceConfigService),
      personalization: app.get(PersonalizationService),
      outPath,
    });

    process.stdout.write(
      `Exported ${result.chats} Chats from ${result.owners} owners; ${result.omissions} fields omitted.\n`,
    );
  } finally {
    await app.close();
  }
}

main(process.argv.slice(2))
  .then(() => process.exit(0))
  .catch(() => {
    process.stderr.write('recency-digest-export failed\n');
    process.exit(1);
  });
