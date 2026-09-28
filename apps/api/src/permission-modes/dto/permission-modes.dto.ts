import { ApiProperty } from '@nestjs/swagger';

import {
  PERMISSION_MODES,
  type PermissionMode,
} from '../../tools/permissions/permission-mode';

export class PermissionModeResponse {
  @ApiProperty({ enum: PERMISSION_MODES })
  value!: PermissionMode;
}

export class PermissionModesResponse {
  @ApiProperty({ type: [PermissionModeResponse] })
  modes!: Array<PermissionModeResponse>;
}
