import { Module } from '@nestjs/common';

import { CoreInfraModule } from '../core-infra.module';
import { TenantDbService } from '../db/tenant-db.service';
import { PersonalizationService } from '../personalization/personalization.service';

@Module({
  imports: [CoreInfraModule],
  providers: [
    {
      provide: PersonalizationService,
      inject: [TenantDbService],
      useFactory: (tenantDb: TenantDbService) =>
        new PersonalizationService(tenantDb),
    },
  ],
})
export class RecencyDigestExportModule {}
