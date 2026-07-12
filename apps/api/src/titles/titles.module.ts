import { Module } from '@nestjs/common';
import { ModelsModule } from '../models/models.module';
import { TitleService } from './title.service';

/**
 * TitlesModule (#78) — post-turn chat title generation. Same deferred-work
 * shape as CompactionModule: fired by the chat loop today, moves to the
 * worker with it (#50).
 */
@Module({
  imports: [ModelsModule],
  providers: [TitleService],
  exports: [TitleService],
})
export class TitlesModule {}
