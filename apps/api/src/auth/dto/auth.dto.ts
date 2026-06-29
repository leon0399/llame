import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  email!: string;

  // bcrypt only hashes the first 72 bytes; allowing more is a false sense of security
  // (chars beyond 72 are silently ignored). Cap at the limit so the bound is honest.
  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

export class LoginDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

export class RevokeSessionsQueryDto {
  @ApiPropertyOptional({ enum: ['others', 'all'], default: 'others' })
  @IsOptional()
  @IsIn(['others', 'all'])
  scope?: 'others' | 'all';
}
