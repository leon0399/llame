import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";

/**
 * Breadcrumb is the navigation landmark for a page's place in a hierarchy.
 *
 * @see https://ui.shadcn.com/docs/components/base/breadcrumb
 * @summary for a page's trail of parent pages
 */
function Breadcrumb({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      aria-label="breadcrumb"
      data-slot="breadcrumb"
      className={cn(className)}
      {...props}
    />
  );
}

/**
 * BreadcrumbList is the ordered list of the trail's items.
 *
 * @summary for the ordered items of a breadcrumb trail
 */
function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        "flex flex-wrap items-center gap-1.5 text-sm wrap-break-word text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * BreadcrumbItem is one step of the trail.
 *
 * @summary for one step of a breadcrumb trail
 */
function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

/**
 * BreadcrumbLink is a step that navigates to its page.
 *
 * @summary for a breadcrumb step that links to its page
 */
function BreadcrumbLink({
  className,
  render,
  ...props
}: useRender.ComponentProps<"a">) {
  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      {
        className: cn("transition-colors hover:text-foreground", className),
      },
      props,
    ),
    render,
    state: {
      slot: "breadcrumb-link",
    },
  });
}

/**
 * BreadcrumbPage is the current page, the trail's last step, in regular
 * weight.
 *
 * @summary for the current page at the end of a breadcrumb trail
 */
function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      // Diverges from upstream, which also sets role="link" and
      // aria-disabled: `aria-current` alone names the current page, and a
      // disabled link role on plain text fails jsx-a11y/prefer-tag-over-role.
      aria-current="page"
      className={cn("font-normal text-foreground", className)}
      {...props}
    />
  );
}

/**
 * BreadcrumbSeparator divides two steps; a chevron by default.
 *
 * @summary for the divider between breadcrumb steps
 */
function BreadcrumbSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn("[&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? <ChevronRightIcon />}
    </li>
  );
}

/**
 * BreadcrumbEllipsis stands for collapsed steps of a long trail.
 *
 * @summary for collapsed steps in a long breadcrumb trail
 */
function BreadcrumbEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      className={cn(
        "flex size-5 items-center justify-center [&>svg]:size-4",
        className,
      )}
      {...props}
    >
      <MoreHorizontalIcon />
      <span className="sr-only">More</span>
    </span>
  );
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
};
