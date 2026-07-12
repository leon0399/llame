import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PinsController } from './pins.controller';
import { PinsService } from './pins.service';

@Module({
  imports: [AuthModule],
  controllers: [PinsController],
  providers: [PinsService],
  exports: [PinsService],
})
export class PinsModule {}
