import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublicUserResponse {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ nullable: true })
  name!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'email' })
  email!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  emailVerified!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  image!: string | null;
}
