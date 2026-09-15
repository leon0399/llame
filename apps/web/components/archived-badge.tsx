import { Badge } from "@workspace/ui/components/badge";
import { ArchiveIcon } from "lucide-react";

/**
 * ArchivedBadge marks a chat or project row as archived. It is a thin
 * composition of the shared `@workspace/ui` `Badge` (`secondary` variant) and
 * nothing more: the pill's metrics, typography, and color are Badge's to own,
 * so this passes no appearance overrides — only whatever layout
 * (`className`) a row needs to place it. Sits inline beside a row title in the
 * sidebar list rows and the pinned rail.
 *
 * @summary the "Archived" pill shown on archived chat/project rows
 */
export function ArchivedBadge({ className }: { className?: string }) {
  return (
    <Badge variant="secondary" className={className}>
      <ArchiveIcon />
      Archived
    </Badge>
  );
}
