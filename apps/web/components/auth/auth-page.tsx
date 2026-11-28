import type { ReactNode } from "react";

/**
 * A signed-out page's content: a heading, one line on what it is for, the
 * form, and the link to the other page. No card: the form is the only thing
 * on the page, so a frame around it only narrows it on a phone.
 */
export function AuthPage({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-balance text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
      <p className="text-center text-sm text-muted-foreground">{footer}</p>
    </div>
  );
}
