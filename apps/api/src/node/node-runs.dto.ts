import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CreateMessageDto } from '../chats/dto/chats.dto';

/** The existing message DTO plus a resource locator, never an owner/principal. */
export class CreateNodeRunDto extends CreateMessageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  chatId!: string;
}

export class AcceptedNodeRunResponse {
  @ApiProperty({ format: 'uuid' })
  runId!: string;
  @ApiProperty({ format: 'uuid' })
  chatId!: string;
  @ApiProperty({ format: 'uuid' })
  messageId!: string;
}
