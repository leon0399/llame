import type { ReactNode } from "react";
import { LoaderCircleIcon } from "lucide-react";

import {
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@workspace/ui/components/trace";

/** Work in progress with no content yet ("Thinking…", a retry, compaction),
 *  drawn as the streaming reasoning line draws itself, so the wait and the
 *  reasoning that follows it look like one line. */
export function ProgressLine({ children }: { children: ReactNode }) {
  return (
    <TraceLine status="running">
      <TraceIcon>
        <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
      </TraceIcon>
      <TraceTitle>{children}</TraceTitle>
    </TraceLine>
  );
}
