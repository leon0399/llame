/**
 * The DI graph for the `machines:*` operator commands (host-as-machine D2's
 * rebind). Deliberately NOT `MachinesModule`: that module builds the connector,
 * its SSH transport factory, the probe job, and the API controller, none of
 * which a forget command needs — and a command that opened a Machine session
 * while removing its binding would be the one sequence an operator never wants.
 * `CoreInfraModule` supplies the `DB_DEV` connection the repository injects.
 */

import { Module } from '@nestjs/common';

import { CoreInfraModule } from '../../core-infra.module';
import { MachineBindingsRepository } from '../machine-bindings.repository';

@Module({
  imports: [CoreInfraModule],
  providers: [MachineBindingsRepository],
})
export class OperationsModule {}
