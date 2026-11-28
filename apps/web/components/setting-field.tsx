import type { ReactNode } from "react";

import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field";

/**
 * One setting, laid out the same way at every width (DESIGN.md §8, Fields):
 *
 * 1. the label, with a compact control (a switch, a small select or button)
 *    at the right of the same line;
 * 2. the description under it, across the field's full width;
 * 3. a wide control (an input, a textarea, a picker) under the description,
 *    across the full width;
 * 4. feedback on the value (a counter, an error) under that control.
 *
 * Nothing moves beside the text on a wide screen, so the description never
 * wraps early around a control and a long field never sits in a side column.
 *
 * @summary a labelled setting: label, description, then its control
 */
export function SettingField({
  id,
  label,
  description,
  action,
  children,
  feedback,
  disabled,
}: {
  /** The control's id, so the label names it. */
  id?: string;
  label: ReactNode;
  description?: ReactNode;
  /** A compact control, drawn at the end of the label's line. */
  action?: ReactNode;
  /** A wide control, drawn under the description. */
  children?: ReactNode;
  feedback?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Field data-disabled={disabled}>
      {/* The description belongs to the label, so it sits closer to it
          than the control does. */}
      <div className="flex flex-col gap-1">
        <div className="flex min-h-5 items-center justify-between gap-4">
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          {action}
        </div>
        {description === undefined ? null : (
          <FieldDescription>{description}</FieldDescription>
        )}
      </div>
      {children}
      {feedback}
    </Field>
  );
}
