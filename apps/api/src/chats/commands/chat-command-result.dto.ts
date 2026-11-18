import { ApiProperty } from '@nestjs/swagger';

export class ChatCommandResultResponse {
  @ApiProperty({ enum: ['command'] })
  type!: 'command';

  @ApiProperty({ enum: ['rename'] })
  command!: 'rename';

  @ApiProperty({ description: 'The updated Chat title.' })
  title!: string;
}
