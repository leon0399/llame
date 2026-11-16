import { ApiProperty } from '@nestjs/swagger';

export class RenameChatCommandResultResponse {
  @ApiProperty({ enum: ['command'] })
  type!: 'command';

  @ApiProperty({ enum: ['rename'] })
  command!: 'rename';

  @ApiProperty({ description: 'The updated Chat title.' })
  title!: string;
}

export class CompactChatCommandResultResponse {
  @ApiProperty({ enum: ['command'] })
  type!: 'command';

  @ApiProperty({ enum: ['compact'] })
  command!: 'compact';

  @ApiProperty({ description: 'The admitted compaction Run id.' })
  runId!: string;
}

export type ChatCommandResultResponse =
  | RenameChatCommandResultResponse
  | CompactChatCommandResultResponse;
