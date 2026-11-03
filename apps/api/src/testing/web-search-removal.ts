import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import { type PermissionGroup } from '../tools/permissions/types';
import { type ToolContext } from '../tools/types';
import {
  createResultRemoval,
  type ResultRemoval,
} from '../tools/web-search/removal';

/**
 * The removal rule of a call whose `read` group is `read` and whose query
 * excludes `excludedHosts`. An absent `read` group leaves the context without
 * a compiled policy, which removes nothing: the fixture for a call that does
 * not test removal.
 */
export function removalFor(
  read: PermissionGroup | undefined,
  excludedHosts: ReadonlyArray<string> = [],
  permissionMode?: PermissionMode,
): ResultRemoval {
  return createResultRemoval(
    {
      userId: 'owner',
      chatId: 'chat',
      tenantDb: {
        runAs: () => Promise.reject(new Error('no database in this test')),
      },
      ...(read !== undefined && {
        permissionPolicy: compileToolPermissionMap({ read }, 'test-policy'),
      }),
      ...(permissionMode !== undefined && { permissionMode }),
    } satisfies ToolContext,
    excludedHosts,
  );
}
