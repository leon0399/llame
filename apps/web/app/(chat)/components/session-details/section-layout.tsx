"use client";

import { useCallback, useState } from "react";
import type { ReactNode } from "react";

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

export interface SectionLayoutState {
  layout: SessionDetailsLayout;
  setOrder: (order: Array<SessionDetailsSectionId>) => void;
  setOpen: (id: SessionDetailsSectionId, open: boolean) => void;
}

export interface SectionListProps {
  state: SectionLayoutState;
  sections: Record<SessionDetailsSectionId, SectionView>;
}

function writeLayout(layout: SessionDetailsLayout) {
  document.cookie = `${SESSION_DETAILS_LAYOUT_COOKIE}=${encodeURIComponent(JSON.stringify(layout))}; path=/; max-age=${String(COOKIE_MAX_AGE_SECONDS)}`;
}

/** The sections' order and folds, remembered in a cookie the server reads.
 *  Owned above the list so the static and draggable lists share it. */
export function useSectionLayout(
  initial: SessionDetailsLayout,
): SectionLayoutState {
  const [layout, setLayout] = useState(initial);

  const update = useCallback((next: SessionDetailsLayout) => {
    setLayout(next);
    writeLayout(next);
  }, []);

  return {
    layout,
    setOrder: (order) => update({ ...layout, order }),
    setOpen: (id, open) => {
      const collapsed = layout.collapsed.filter((entry) => entry !== id);
      update({ ...layout, collapsed: open ? collapsed : [...collapsed, id] });
    },
  };
}

/** The sections in the user's order without drag handles: the same markup the
 *  draggable list renders, shown until its framer-motion chunk has loaded. */
export function StaticSectionList({ state, sections }: SectionListProps) {
  return (
    <ul className="flex flex-col">
      {state.layout.order.map((id) => (
        <li
          key={id}
          className="relative border-t border-sidebar-border bg-sidebar first:border-t-0"
        >
          <DetailsSection
            title={sections[id].title}
            badge={sections[id].badge}
            summary={sections[id].summary}
            open={!state.layout.collapsed.includes(id)}
            onOpenChange={(open) => state.setOpen(id, open)}
          >
            {sections[id].content}
          </DetailsSection>
        </li>
      ))}
    </ul>
  );
}
