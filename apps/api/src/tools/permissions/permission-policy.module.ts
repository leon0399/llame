import { Global, Module } from '@nestjs/common';

import { InstanceConfigService } from '../../instance-config/instance-config.service';
import { buildToolPermissionPolicy } from './policy-provider';
import { type CompiledPolicy } from './types';

/** Injection token for the immutable per-process compiled permission policy. */
export const TOOL_PERMISSION_POLICY = Symbol('TOOL_PERMISSION_POLICY');

export type ToolPermissionPolicy = CompiledPolicy;

/**
 * The awaited provider definition. Kept exported so tests can assert that an
 * invalid policy rejects module initialization (boot) rather than leaking a
 * partially compiled policy into a running process.
 */
export const toolPermissionPolicyProvider = {
  provide: TOOL_PERMISSION_POLICY,
  inject: [InstanceConfigService],
  useFactory: (config: InstanceConfigService) =>
    buildToolPermissionPolicy(config.config.tools.permissions),
};

/**
 * Builds the permission policy through an awaited async factory so module
 * initialization cannot complete with an uncompiled or invalid policy. An
 * invalid configured pattern or field rejects the factory and aborts bootstrap
 * before the process serves requests or claims jobs.
 *
 * `@Global` because the policy is a per-process cross-cutting dependency (like
 * InstanceConfigModule): the execution service lives in RunWorkerModule, but
 * the policy is compiled once from instance config in CoreInfraModule so both
 * entrypoints share one instance.
 */
@Global()
@Module({
  providers: [toolPermissionPolicyProvider],
  exports: [TOOL_PERMISSION_POLICY],
})
export class ToolPermissionPolicyModule {}
