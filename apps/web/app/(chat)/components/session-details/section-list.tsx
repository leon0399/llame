"use client";

import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { Reorder, useDragControls } from "framer-motion";

import {
  SESSION_DETAILS_LAYOUT_COOKIE,
  type SessionDetailsLayout,
  type SessionDetailsSectionId,
} from "./details-cookie";
import { DetailsSection } from "./details-section";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface SectionView {
  title: string;
  badge?: ReactNode;
  summary: ReactNode;
  content: ReactNode;
}

function writeLayout(layout: SessionDetailsLayout) {
  document.cookie = `${SESSION_DETAILS_LAYOUT_COOKIE}=${encodeURIComponent(JSON.stringify(layout))}; path=/; max-age=${String(COOKIE_MAX_AGE_SECONDS)}`;
}

/** The sections' order and folds, remembered in a cookie the server reads. */
function useSectionLayout(initial: SessionDetailsLayout) {
  const [layout, setLayout] = useState(initial);

  const update = useCallback((next: SessionDetailsLayout) => {
    setLayout(next);
    writeLayout(next);
  }, []);

  return {
    layout,
    setOrder: (order: Array<SessionDetailsSectionId>) =>
      update({ ...layout, order }),
    setOpen: (id: SessionDetailsSectionId, open: boolean) => {
      const collapsed = layout.collapsed.filter((entry) => entry !== id);
      update({ ...layout, collapsed: open ? collapsed : [...collapsed, id] });
    },
  };
}

/** How long a dropped section takes to settle into its slot. */
const SETTLE_MS = 300;

/** Framer animates every list item's position change; that is wanted while a
 *  section is dragged and its neighbours make room, and nowhere else (a row
 *  arriving in one section would otherwise slide the others down). */
const INSTANT = { layout: { duration: 0 } };

function SortableSection({
  id,
  view,
  open,
  onOpenChange,
  reordering,
}: {
  id: SessionDetailsSectionId;
  view: SectionView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reordering: ReorderingState;
}) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      as="li"
      value={id}
      dragListener={false}
      dragControls={dragControls}
      transition={reordering.active ? undefined : INSTANT}
      onDragStart={reordering.start}
      onDragEnd={reordering.end}
      // The rail's own divider between sections, and its surface while one
      // is dragged over the others.
      className="relative border-t border-sidebar-border bg-sidebar first:border-t-0"
    >
      <DetailsSection
        title={view.title}
        badge={view.badge}
        summary={view.summary}
        open={open}
        onOpenChange={onOpenChange}
        dragControls={dragControls}
      >
        {view.content}
      </DetailsSection>
    </Reorder.Item>
  );
}

interface ReorderingState {
  active: boolean;
  start: () => void;
  end: () => void;
}

/** True from a drag's start until the dropped section has settled. */
function useReordering(): ReorderingState {
  const [active, setActive] = useState(false);
  return {
    active,
    start: () => setActive(true),
    end: () => setTimeout(() => setActive(false), SETTLE_MS),
  };
}

/** The session details sections, full width in the user's order, each
 *  foldable and draggable by its title row's handle. */
export function SectionList({
  initialLayout,
  sections,
}: {
  initialLayout: SessionDetailsLayout;
  sections: Record<SessionDetailsSectionId, SectionView>;
}) {
  const { layout, setOrder, setOpen } = useSectionLayout(initialLayout);
  const reordering = useReordering();

  return (
    <Reorder.Group
      as="ul"
      axis="y"
      values={layout.order}
      onReorder={setOrder}
      className="flex flex-col"
    >
      {layout.order.map((id) => (
        <SortableSection
          key={id}
          id={id}
          view={sections[id]}
          open={!layout.collapsed.includes(id)}
          onOpenChange={(open) => setOpen(id, open)}
          reordering={reordering}
        />
      ))}
    </Reorder.Group>
  );
}
