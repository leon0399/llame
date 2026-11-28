"use client";

import { ProgressLine } from "./progress-line";
import { useThinkingVerb } from "./use-thinking-verb";

/** The wait before a reply has any content: a rotating verb, "Pondering…".
 *  Assistive technology hears one steady "Thinking" instead of each verb. */
export function ThinkingLine() {
  const verb = useThinkingVerb(true);

  return (
    <output aria-label="Thinking" className="block">
      <ProgressLine>
        <span aria-hidden="true">{`${verb}…`}</span>
      </ProgressLine>
    </output>
  );
}
