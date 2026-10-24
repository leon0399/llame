"use client";

import { useState, type ReactNode } from "react";

import {
  MediaThumbnailRow,
  type MediaThumbnailItem,
} from "@workspace/ui/components/custom/media-thumbnail";
import { PencilIcon, PlusIcon } from "lucide-react";

import { IconButtonTooltip } from "@/components/icon-button-tooltip";
import { DemoChip } from "@/app/shell/soon-chip";

import { ProjectRepositoriesSection } from "./project-repositories-section";

/** One titled section of the panel, with its single action on the right.
 *  Every section here is still a sample-data preview, so each carries the
 *  demo chip. */
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
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {title}
          <DemoChip />
        </h2>
        {action}
      </div>
      {children}
    </section>
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
        <IconButtonTooltip
          label={hasInstructions ? "Edit instructions" : "Add instructions"}
          size="icon-sm"
          onClick={() => setHasInstructions((current) => !current)}
        >
          {hasInstructions ? <PencilIcon /> : <PlusIcon />}
        </IconButtonTooltip>
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
        <IconButtonTooltip
          label="Add context"
          size="icon-sm"
          onClick={() => {
            setFiles((current) => [...current, sampleFile(added)]);
            setAdded((count) => count + 1);
          }}
        >
          <PlusIcon />
        </IconButtonTooltip>
      }
    >
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add PDFs, documents, or other text to reference in this project.
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

/** The project page's side panel: the project's settings, demo previews
 *  first, then its repositories. From `lg` it takes the page grid's third
 *  column beside the composer and chats, out of flow so its height never
 *  stretches the composer's row. */
export function ProjectSidePanel({ projectId }: { projectId: string }) {
  return (
    <div className="min-w-0 lg:relative lg:col-start-3 lg:row-span-2 lg:row-start-1">
      <aside
        aria-label="Project settings"
        className="divide-y rounded-lg border lg:absolute lg:inset-x-0 lg:top-0"
      >
        <InstructionsSection />
        <ContextSection />
        <ProjectRepositoriesSection projectId={projectId} />
      </aside>
    </div>
  );
}
