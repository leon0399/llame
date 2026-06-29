import { ApiProperty } from '@nestjs/swagger';

// These fields are always PRESENT but may be null. Reflection can't infer a scalar type
// from a `T | null` union (it emits `type: object`), so the type is declared explicitly
// and the field is required-nullable (@ApiProperty + nullable), not optional.
export class PublicUserResponse {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'email' })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  emailVerified!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  image!: string | null;
}
