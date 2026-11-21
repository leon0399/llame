/**
 * The `GET /api/v1/machines` response. Deliberately only what the spec says a
 * user may see: the Machine's name, its derived status, its last successful
 * contact, the last failure reason, the protocol versions, the registered
 * roots, and the static facts the daemon reported. The SSH destination, the
 * jump host, every configured path, and the instance id stay on the hub and
 * are never part of this shape.
 */

import { ApiProperty } from '@nestjs/swagger';
import { type MachineFacts } from '@workspace/machine-protocol';

import {
  MACHINE_FAILURE_REASONS,
  type MachineFailureReason,
  type MachineStatus,
  type MachineStatusView,
} from '../machines-status';

/** One registered root's filesystem size, as the daemon reported it. */
export class MachineRootDiskResponse {
  @ApiProperty({ description: 'The registered root this entry measures.' })
  root!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Total bytes of the filesystem holding the root.',
  })
  totalBytes!: number | null;
}

/** The static facts a Machine daemon reported at its last handshake. */
export class MachineFactsResponse {
  @ApiProperty({ description: 'The operating system, as `os.platform()`.' })
  os!: string;

  @ApiProperty({ description: 'The CPU architecture, as `os.arch()`.' })
  arch!: string;

  @ApiProperty({ description: 'The kernel release, as `os.release()`.' })
  kernel!: string;

  @ApiProperty({ description: 'The number of usable CPUs.' })
  cpuCount!: number;

  @ApiProperty({ description: 'The total memory in bytes.' })
  totalMemoryBytes!: number;

  @ApiProperty({
    type: () => [MachineRootDiskResponse],
    description: 'One entry per registered root, in registration order.',
  })
  rootDisks!: Array<MachineRootDiskResponse>;
}

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
    type: () => MachineFactsResponse,
    nullable: true,
    description:
      'Static facts the daemon reported at its last successful handshake; null before the first one.',
  })
  facts!: MachineFactsResponse | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the facts were captured.',
  })
  factsCapturedAt!: string | null;

  @ApiProperty({
    type: [String],
    description: "The Machine's registered roots; addressing, not isolation.",
  })
  roots!: Array<string>;
}

function toMachineFactsResponse(facts: MachineFacts): MachineFactsResponse {
  return {
    os: facts.os,
    arch: facts.arch,
    kernel: facts.kernel,
    cpuCount: facts.cpuCount,
    totalMemoryBytes: facts.totalMemoryBytes,
    rootDisks: facts.rootDisks.map((disk) => ({
      root: disk.root,
      totalBytes: disk.totalBytes,
    })),
  };
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
    facts: view.facts === null ? null : toMachineFactsResponse(view.facts),
    factsCapturedAt: view.factsCapturedAt?.toISOString() ?? null,
    roots: [...view.roots],
  };
}
