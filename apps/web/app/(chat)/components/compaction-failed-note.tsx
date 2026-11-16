import { Badge } from "@workspace/ui/components/badge";
import { InfoIcon } from "lucide-react";

/**
 * The persisted `data-compaction-failed` part of a reply (design D15): a
 * compaction at a step boundary returned no summary, so the Run went on with
 * its full history. Rendered from the stored part, so a reload shows it too.
 *
 * @summary a muted note that a mid-turn compaction failed
 */
export function CompactionFailedNote() {
  return (
    <Badge variant="outline" className="my-1">
      <InfoIcon className="h-3 w-3 shrink-0" />
      Compaction failed — continued with the full history
    </Badge>
  );
}
