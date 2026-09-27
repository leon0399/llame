import { Module } from '@nestjs/common';

import { PermissionModesController } from './permission-modes.controller';

@Module({
  controllers: [PermissionModesController],
})
export class PermissionModesModule {}
