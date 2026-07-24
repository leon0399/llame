"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, toast, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

/**
 * Themed toast host. Mount once near the root layout to render toasts
 * triggered anywhere via the re-exported `toast()`. Follows the app's
 * next-themes theme automatically and skins toasts with the design-system
 * tokens and lucide status icons.
 *
 * @see https://ui.shadcn.com/docs/components/base/sonner
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

// `toast` is re-exported so consumers depend on this design-system module
// rather than taking a direct (phantom) dependency on `sonner`.
export { Toaster, toast };
