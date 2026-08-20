import { ApiProperty } from '@nestjs/swagger';

const ORG_UNIT_CONFLICT_CODES = [
  'CONCURRENT_TREE_CHANGE',
  'DUPLICATE_MEMBERSHIP',
  'HAS_CHILDREN',
  'LAST_OWNER',
] as const;

export class ErrorResponse {
  @ApiProperty()
  statusCode!: number;

  @ApiProperty()
  error!: string;

  @ApiProperty()
  message!: string;
}

export class OrgUnitConflictErrorResponse extends ErrorResponse {
  @ApiProperty({ enum: ORG_UNIT_CONFLICT_CODES })
  code!: (typeof ORG_UNIT_CONFLICT_CODES)[number];
}

export class OrgUnitValidationErrorResponse extends ErrorResponse {
  @ApiProperty({ enum: ['MOVE_INTO_OWN_SUBTREE'] })
  code!: 'MOVE_INTO_OWN_SUBTREE';
}
