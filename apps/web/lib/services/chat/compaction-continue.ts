import { z } from "zod";

import { contextItemEnvelope } from "./context-item-envelope";

const compactionContinuePayloadSchema = z.object({
  quote: z.string().nullable(),
});

/** The continue item a step-boundary compaction authors on the message that
 *  resumes the Run. The transcript shows only that the context was compacted;
 *  the quoted request stays model context. */
export type CompactionContinuePart = {
  type: "data-context";
  data: {
    v: 1;
    producer: "compaction";
    form: "notice";
    runId: string;
    payload: z.infer<typeof compactionContinuePayloadSchema>;
    text?: string;
  };
};

export function isCompactionContinuePart(
  value: unknown,
): value is CompactionContinuePart {
  const envelope = contextItemEnvelope(value, "compaction");

  return (
    envelope !== undefined &&
    compactionContinuePayloadSchema.safeParse(envelope.payload).success
  );
}
