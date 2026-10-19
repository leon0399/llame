/**
 * The `GET /api/v1/machines` response. Deliberately only what the spec says a
 * user may see: the Machine's name, its derived status, its last successful
 * contact, the last failure reason, the protocol versions, and the registered
 * roots. The SSH destination, the jump host, and every configured path stay on
 * the hub (`machines.ssh`, `machines.hosts`) and are never part of this shape.
 */

import { ApiProperty } from '@nestjs/swagger';

import {
  MACHINE_FAILURE_REASONS,
  type MachineFailureReason,
  type MachineStatus,
  type MachineStatusView,
} from '../machines-status';

export class MachineResponse {
  @ApiProperty({ description: 'The configured Machine name.' })
  name!: string;

  @ApiProperty({
    enum: ['online', 'offline'],
    description:
      'Online when the last successful contact is inside the inactivity window and after the last failure.',
  })
  status!: MachineStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When the hub last completed a handshake with this Machine.',
  })
  lastSeenAt!: string | null;

  @ApiProperty({
    enum: MACHINE_FAILURE_REASONS,
    nullable: true,
    description: 'Why the last contact attempt failed, when one did.',
  })
  failureReason!: MachineFailureReason | null;

  @ApiProperty({ description: 'The protocol version the hub speaks.' })
  hubProtocolVersion!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The protocol version the daemon reported, once known.',
  })
  daemonProtocolVersion!: number | null;

  @ApiProperty({ type: String, nullable: true })
  daemonVersion!: string | null;

  @ApiProperty({
    type: [String],
    description: "The Machine's registered roots; addressing, not isolation.",
  })
  roots!: Array<string>;
}

export function toMachineResponse(view: MachineStatusView): MachineResponse {
  return {
    name: view.name,
    status: view.status,
    lastSeenAt: view.lastSeenAt,
    failureReason: view.failureReason,
    hubProtocolVersion: view.hubProtocolVersion,
    daemonProtocolVersion: view.daemonProtocolVersion,
    daemonVersion: view.daemonVersion,
    roots: [...view.roots],
  };
}
