import { ApiProperty } from '@nestjs/swagger';
import { PublicUserResponse } from '../../users/public-user.response';

export class SessionResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  // Present-but-nullable: required in the response, value may be null (not omittable).
  @ApiProperty({ type: String, nullable: true })
  userAgent!: string | null;

  @ApiProperty({ type: String, nullable: true })
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
