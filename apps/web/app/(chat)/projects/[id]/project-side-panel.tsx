"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@workspace/ui/components/button";
import {
  MediaThumbnailRow,
  type MediaThumbnailItem,
} from "@workspace/ui/components/custom/media-thumbnail";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { PencilIcon, PlusIcon } from "lucide-react";

/** One titled section of the panel, with its single action on the right. */
function PanelSection({
  title,
  action,
  children,
}: {
  title: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 p-4" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A section's icon action, labelled by its tooltip. */
function PanelAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" onClick={onClick} />}
      >
        {icon}
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const SAMPLE_INSTRUCTIONS =
  "Be direct and critical. Lead with the answer, then the reasoning. Prefer small, reversible changes and say when an idea is weak.";

/**
 * Instructions, as a demo: the action flips between the empty state and
 * sample text, and nothing is saved.
 *
 * TODO(#1329): store the project's instructions, edit them here, and send
 * them with every chat filed into the project.
 */
function InstructionsSection() {
  const [hasInstructions, setHasInstructions] = useState(false);
  return (
    <PanelSection
      title="Instructions"
      action={
        <PanelAction
          label={hasInstructions ? "Edit instructions" : "Add instructions"}
          icon={hasInstructions ? <PencilIcon /> : <PlusIcon />}
          onClick={() => setHasInstructions((current) => !current)}
        />
      }
    >
      {hasInstructions ? (
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {SAMPLE_INSTRUCTIONS}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Add instructions to tailor llame&apos;s responses
        </p>
      )}
    </PanelSection>
  );
}

const SAMPLE_FILES = [
  "Design notes.pdf",
  "Architecture overview.pdf",
  "Roadmap.pdf",
];

/** The next sample card; numbered once the names run out, so keys stay unique. */
function sampleFile(count: number): MediaThumbnailItem {
  const base = SAMPLE_FILES[count % SAMPLE_FILES.length] ?? "Notes.pdf";
  const round = Math.floor(count / SAMPLE_FILES.length);
  const name = round === 0 ? base : base.replace(".pdf", ` ${round + 1}.pdf`);
  return { key: `sample-${count}`, kind: "pdf", name };
}

/**
 * Context, as a demo: + adds a sample card, the card's own remove button
 * takes it away, and nothing is uploaded or stored.
 *
 * TODO(#1330): store the project's context files and make them reachable
 * from the project's chats, with a visible capacity.
 */
function ContextSection() {
  const [files, setFiles] = useState<Array<MediaThumbnailItem>>([]);
  const [added, setAdded] = useState(0);
  return (
    <PanelSection
      title="Context"
      action={
        <PanelAction
          label="Add context"
          icon={<PlusIcon />}
          onClick={() => {
            setFiles((current) => [...current, sampleFile(added)]);
            setAdded((count) => count + 1);
          }}
        />
      }
    >
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add files the project&apos;s chats can draw on
        </p>
      ) : (
        <MediaThumbnailRow
          items={files}
          variant="card"
          aria-label="Project context"
          onRemove={(key) =>
            setFiles((current) => current.filter((file) => file.key !== key))
          }
        />
      )}
    </PanelSection>
  );
}

/** The project page's side panel: the project's own settings, as previews of
 *  what is coming. */
export function ProjectSidePanel() {
  return (
    <aside
      aria-label="Project settings"
      className="self-start divide-y rounded-lg border"
    >
      <InstructionsSection />
      <ContextSection />
    </aside>
  );
}
