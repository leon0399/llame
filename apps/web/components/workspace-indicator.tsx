import { FolderIcon } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { Badge } from "@workspace/ui/components/badge";

/**
 * Shows the current Chat Workspace root as compact header metadata. The final
 * path segment keeps the header readable while the tooltip exposes the
 * complete canonical path for inspection.
 */
export function WorkspaceIndicator({
  workspaceRoot,
}: {
  workspaceRoot: string | null;
}) {
  if (workspaceRoot === null) return null;

  const withoutTrailingSeparators = workspaceRoot.replace(/\/+$/, "");
  const name =
    withoutTrailingSeparators.length === 0
      ? workspaceRoot
      : withoutTrailingSeparators.slice(
          withoutTrailingSeparators.lastIndexOf("/") + 1,
        );
  const label = `Workspace: ${workspaceRoot}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={<Badge variant="outline" aria-label={label} tabIndex={0} />}
      >
        <FolderIcon />
        {name}
      </TooltipTrigger>
      <TooltipContent>{workspaceRoot}</TooltipContent>
    </Tooltip>
  );
}
