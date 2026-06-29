import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PublicUserResponse } from '../../users/public-user.response';

export class SessionResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ nullable: true })
  userAgent!: string | null;

  @ApiPropertyOptional({ nullable: true })
  ip!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  lastSeenAt!: Date;

  @ApiProperty({ format: 'date-time' })
  expires!: Date;

  @ApiProperty()
  current!: boolean;
}

export class AuthTokenResponse {
  @ApiProperty({
    description:
      'Opaque bearer token. Stored server-side only as a SHA-256 hash.',
  })
  token!: string;

  @ApiProperty({ type: () => PublicUserResponse })
  user!: PublicUserResponse;

  @ApiProperty({ type: () => SessionResponse })
  session!: SessionResponse;
}

export class SessionsResponse {
  @ApiProperty({ type: () => [SessionResponse] })
  sessions!: SessionResponse[];
}

export class SessionRevocationResponse {
  @ApiProperty()
  revokedCount!: number;
}
