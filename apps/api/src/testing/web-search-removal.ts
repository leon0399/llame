import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
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
    } satisfies ToolContext,
    excludedHosts,
  );
}
