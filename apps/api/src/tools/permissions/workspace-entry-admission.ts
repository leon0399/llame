import { Inject, Injectable } from '@nestjs/common';

import { InstanceConfigService } from '../../instance-config/instance-config.service';
import { MachineConnector } from '../../machines/machine-connector.service';

import {
  type AdmissionMode,
  canonicalPathEvaluation,
  decidePermission,
  evaluateCanonicalWithRejectTexts,
} from './admit';
import { projectNativeFilePath } from './locator-projection';
import { TOOL_PERMISSION_POLICY } from './permission-policy.module';
import { type CompiledPolicy, type PermissionDecision } from './types';

/*
 * The `enter_workspace` gate every path-binding entry shares (design D4): the
 * operator's tool allowlist, the Machine identity a submitted path projects
 * through, and the compiled policy its address forms are decided under. Chat
 * creation and checkout registration decide the same group over the same
 * projection, so the two live here once rather than once per route.
 */

/** The one tool group these routes are gated by. */
export const WORKSPACE_TOOL_ID = 'enter_workspace';

@Injectable()
export class WorkspaceEntryAdmission {
  constructor(
    // Explicit token: the parameter is narrowed to the reader capability, so
    // the emitted design type is not the class Nest would resolve.
    @Inject(InstanceConfigService)
    private readonly config: Pick<InstanceConfigService, 'config'>,
    private readonly connector: MachineConnector,
    @Inject(TOOL_PERMISSION_POLICY)
    private readonly policy: CompiledPolicy,
  ) {}

  /** Whether the operator put `enter_workspace` in `tools.allowed`. */
  allowsTool(): boolean {
    return this.config.config.tools.allowed.includes(WORKSPACE_TOOL_ID);
  }

  /**
   * One path's decision in the group: the submitted text stands when it
   * rejects for any reason but `no_allow`, otherwise the projected canonical
   * address decides — so a spelling cannot be arranged to miss a reject
   * clause.
   */
  decide(path: string, mode: AdmissionMode): PermissionDecision {
    const projection = projectNativeFilePath(path, {
      defaultMachine: this.connector.defaultMachine(),
      localMachine: this.connector.localMachine(),
    });

    return decidePermission(this.policy, mode, (evaluate) =>
      evaluateCanonicalWithRejectTexts(
        evaluate,
        canonicalPathEvaluation(WORKSPACE_TOOL_ID, path, projection),
      ),
    );
  }
}
