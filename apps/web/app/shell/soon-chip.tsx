// Visible "coming soon" chip — parity between the primary sidebar's disabled
// placeholders and the admin section nav's own stub sections (org-admin-ui
// spec "'Soon'-chip parity"). Deliberately not the shared `Badge` primitive:
// Badge defaults to `rounded-full` (a pill), which DESIGN.md §10b forbids for
// this kind of chrome — this stays on the 10px-derived radius scale instead.
export function SoonChip() {
  return (
    <span className="ml-auto shrink-0 rounded-md border px-1.5 py-0 text-[10px] tracking-wide text-muted-foreground">
      soon
    </span>
  );
}
