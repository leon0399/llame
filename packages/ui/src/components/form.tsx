"use client";

import * as React from "react";
import type { Label as LabelPrimitive } from "radix-ui";
import { Slot } from "radix-ui";
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";

import { cn } from "@workspace/ui/lib/utils";
import { Label } from "@workspace/ui/components/label";

/**
 * Form binds react-hook-form's `FormProvider` to the `FormField`/`FormItem`
 * family below, so field state, validation, and error messages flow through
 * context instead of manual prop drilling.
 *
 * @see https://ui.shadcn.com/docs/components/radix/form
 * @summary for wiring react-hook-form context through the Form* subcomponents
 */
const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>(
  {} as FormFieldContextValue,
);

/**
 * FormField connects one react-hook-form field (by `name`) to the
 * `FormItem` subtree via context, so `FormLabel`/`FormControl`/
 * `FormDescription`/`FormMessage` can read its id and validation state
 * without prop drilling. Accepts the same props as react-hook-form's
 * `Controller`.
 *
 * @summary for wiring a single react-hook-form field into a FormItem
 */
const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
};

/**
 * useFormField reads the current field's id, name, and react-hook-form
 * validation state from `FormField`/`FormItem` context. Used internally by
 * the Form* subcomponents; must be called within a `FormField`.
 *
 * @summary for reading the current FormField's id and validation state
 */
const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>");
  }

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
};

type FormItemContextValue = {
  id: string;
};

const FormItemContext = React.createContext<FormItemContextValue>(
  {} as FormItemContextValue,
);

/**
 * FormItem scopes a unique id to one field's label, control, description,
 * and message, and lays them out in a vertical stack.
 *
 * @summary for grouping a field's label, control, description, and message
 */
function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = React.useId();

  return (
    <FormItemContext.Provider value={{ id }}>
      <div
        data-slot="form-item"
        className={cn("grid gap-2", className)}
        {...props}
      />
    </FormItemContext.Provider>
  );
}

/**
 * FormLabel is a `Label` bound to its `FormField`'s control via `htmlFor`,
 * styled destructive when the field has a validation error.
 *
 * @summary for a field label that turns destructive on validation error
 */
function FormLabel({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  const { error, formItemId } = useFormField();

  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      className={cn("data-[error=true]:text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    />
  );
}

/**
 * FormControl forwards the field's id and `aria-invalid`/`aria-describedby`
 * wiring onto its single child via `Slot` — wrap the actual input/select/etc
 * with it.
 *
 * @summary for wiring a field's id and validation attrs onto its input
 */
function FormControl({ ...props }: React.ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId } =
    useFormField();

  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={
        !error
          ? `${formDescriptionId}`
          : `${formDescriptionId} ${formMessageId}`
      }
      aria-invalid={!!error}
      {...props}
    />
  );
}

/**
 * FormDescription renders helper text for a field, linked to its control via
 * `aria-describedby`.
 *
 * @summary for a field's helper text
 */
function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();

  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * FormMessage renders the field's react-hook-form validation error message,
 * or (absent an error) its own `children`; renders nothing when both are
 * empty.
 *
 * @summary for a field's validation error message
 */
function FormMessage({ className, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error?.message ?? "") : props.children;

  if (!body) {
    return null;
  }

  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      className={cn("text-sm text-destructive", className)}
      {...props}
    >
      {body}
    </p>
  );
}

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
};
