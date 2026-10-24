import { ApiProperty } from '@nestjs/swagger';

import {
  REPOSITORY_FAILURE_CODES,
  type RepositoryFailureCode,
} from '../failure';

/**
 * The documented error envelope of the repository and checkout routes. Every
 * route that can answer a typed failure lists this schema on that status, so
 * the answer a client parses and the answer the document promises are the same
 * object.
 */
export class RepositoryFailureResponse {
  @ApiProperty()
  statusCode!: number;

  @ApiProperty()
  error!: string;

  @ApiProperty({ enum: REPOSITORY_FAILURE_CODES })
  code!: RepositoryFailureCode;

  @ApiProperty()
  message!: string;
}
