import type { ReactNode } from "react";

import { Badge } from "@workspace/ui/components/badge";
import { InfoIcon } from "lucide-react";

/**
 * The persisted `data-compaction-failed` part of a reply (design D15): a
 * compaction at a step boundary returned no summary, so the Run went on with
 * its full history. Rendered from the stored part, so a reload shows it too.
 *
 * @summary a muted note that a mid-turn compaction failed
 */
function CompactionNote({ children }: { children: ReactNode }) {
  return (
    <Badge variant="outline" className="my-1">
      <InfoIcon className="h-3 w-3 shrink-0" />
      {children}
    </Badge>
  );
}

export function CompactionFailedNote() {
  return (
    <CompactionNote>
      Compaction failed — continued with the full history
    </CompactionNote>
  );
}

/**
 * The persisted `data-compaction-disabled` part of a reply (design D13): the
 * automatic compaction did not bring the request under its threshold, or
 * failed, so it stays off for the rest of this Run. `/compact` still works.
 *
 * @summary a muted note that automatic compaction stopped for this Run
 */
export function CompactionDisabledNote() {
  return (
    <CompactionNote>
      Automatic compaction is off for this Run — use /compact to compact
    </CompactionNote>
  );
}
