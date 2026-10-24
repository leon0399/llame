import { Injectable } from '@nestjs/common';
import {
  inspectRepository,
  type GitInspectResult,
} from '@workspace/git-executor';

/**
 * The in-process git surface of the local executor (design D4).
 *
 * The daemon and the hub run the same package, so one implementation owns the
 * argv, the fixed environment, the hooks and fsmonitor overrides, and the
 * timeout. Injected through {@link GIT_INSPECTOR} so a suite can substitute a
 * fake without mocking a module.
 */
export const GIT_INSPECTOR = Symbol('GIT_INSPECTOR');

export type GitInspector = {
  inspect(path: string): Promise<GitInspectResult>;
};

@Injectable()
export class LocalGitInspector implements GitInspector {
  inspect(path: string): Promise<GitInspectResult> {
    return inspectRepository({ path });
  }
}
