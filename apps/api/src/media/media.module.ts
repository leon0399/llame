import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [AuthModule],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
