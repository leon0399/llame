import { Badge } from "@workspace/ui/components/badge";
import { cn } from "@workspace/ui/lib/utils";
import { ArchiveIcon } from "lucide-react";

/**
 * ArchivedBadge marks a chat or project row as archived, per the double-sidebar
 * mock's `.arch-badge`. It is a thin composition of the shared `@workspace/ui`
 * `Badge` (`secondary` variant), NOT a new primitive — it only overrides the
 * mock's smaller-pill metrics (a visible border, muted text, and a ~9.6px tag
 * that `secondary`/`outline` don't provide out of the box). Sits inline beside a
 * row title in the sidebar list rows and the pinned rail.
 *
 * @summary the "Archived" pill shown on archived chat/project rows
 */
export function ArchivedBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="secondary"
      // Overrides on Badge's structural base: visible border + muted text
      // (secondary gives neither), and the mock's tighter padding / smaller
      // text / smaller icon (~9.6px vs Badge's 12px). Concrete arbitrary values
      // match the mock's `.arch-badge` exactly rather than approximating.
      className={cn(
        "border-border text-muted-foreground gap-[.2rem] leading-none tracking-[.01em]",
        "py-[.07rem] pr-[.34rem] pl-[.28rem] text-[.6rem] [&>svg]:size-[10px]",
        className,
      )}
    >
      <ArchiveIcon />
      Archived
    </Badge>
  );
}
