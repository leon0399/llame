import type { ReactNode } from "react";

import { Button } from "@workspace/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
} from "@workspace/ui/components/sidebar";
import { ChevronRightIcon } from "lucide-react";

/** The heading's chevron: hidden until the heading is hovered or holds
 *  focus (always shown where there is no hover), by opacity rather than
 *  display so the heading never shifts. It points down while open. */
function GroupToggle({ title }: { title: string }) {
  return (
    <span className="ml-auto flex opacity-0 transition-opacity group-hover/heading:opacity-100 group-focus-within/heading:opacity-100 [@media(hover:none)]:opacity-100">
      <CollapsibleTrigger
        render={
          <Button
            variant="disclosure"
            size="icon-xs"
            className="group/toggle size-5"
          />
        }
      >
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3.5 transition-transform duration-200 ease-linear group-data-panel-open/toggle:rotate-90"
        />
        <span className="sr-only">{`Toggle ${title}`}</span>
      </CollapsibleTrigger>
    </span>
  );
}

/**
 * A sidebar group that folds away. Only the small chevron on the right of
 * its heading toggles it — the heading text stays plain — and the chevron
 * points down while the group is open. Open by default; the state lasts
 * until the list unmounts. The fold animates with the sidebar's own motion.
 *
 * `headingWrapper` lets a caller set the heading into its own frame — the
 * chat lists' sticky, surface-painted anchor — without this component
 * knowing about it.
 */
export function CollapsibleSidebarGroup({
  title,
  headingWrapper = (heading) => heading,
  children,
}: {
  title: string;
  headingWrapper?: (heading: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen>
      <SidebarGroup>
        {headingWrapper(
          <SidebarGroupLabel className="group/heading">
            {title}
            <GroupToggle title={title} />
          </SidebarGroupLabel>,
        )}
        <CollapsibleContent animated>{children}</CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
