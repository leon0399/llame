import { z } from "zod";

import { contextItemEnvelope } from "./context-item-envelope";

const jobNoticePayloadSchema = z.object({
  locator: z.string().refine((value) => value.trim().length > 0),
  state: z.enum(["succeeded", "failed", "cancelled", "timed_out", "lost"]),
});

/** The API-authored settlement item as rendered by the transcript. */
export type JobNoticePart = {
  type: "data-context";
  data: {
    v: 1;
    producer: "job";
    form: "notice";
    runId: string;
    payload: z.infer<typeof jobNoticePayloadSchema>;
    text?: string;
  };
};

/** Validate only rendered fields; other payload fields remain private. */
export function isJobNoticePart(value: unknown): value is JobNoticePart {
  const envelope = contextItemEnvelope(value, "job");

  return (
    envelope !== undefined &&
    jobNoticePayloadSchema.safeParse(envelope.payload).success
  );
}

/** Accepted job notices from a message, in stored order. */
export function jobNoticeParts(message: {
  parts: ReadonlyArray<unknown>;
}): Array<JobNoticePart> {
  return message.parts.filter(isJobNoticePart);
}
