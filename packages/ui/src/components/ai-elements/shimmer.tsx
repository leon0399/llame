"use client";

import { cn } from "@workspace/ui/lib/utils";
import { type CSSProperties, memo, useMemo } from "react";

/** Intrinsic tags the shimmer can render as. */
export type ShimmerTag =
  | "code"
  | "div"
  | "em"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "li"
  | "p"
  | "pre"
  | "small"
  | "span"
  | "strong";

export type TextShimmerProps = {
  /** Text to render with the shimmer sweep. */
  children: string;
  /** Tag to render as — e.g. `"span"` for inline use within a sentence. */
  as?: ShimmerTag;
  className?: string;
  /** Seconds for one shimmer sweep to loop. */
  duration?: number;
  /**
   * Multiplier (× the text length, in px) controlling the shimmer
   * highlight's width — smaller values produce a tighter, more localized
   * sweep.
   */
  spread?: number;
};

/**
 * Shimmer renders text with an animated gradient sweep, for an in-progress
 * or loading state (e.g. "Thinking…" while a response streams in). Vendored
 * from [AI Elements Shimmer](https://elements.ai-sdk.dev/components/shimmer),
 * with the sweep as a CSS animation (`animate-text-shimmer` in globals.css)
 * instead of `motion/react`, so it costs no JavaScript.
 *
 * @summary animated shimmering text for in-progress/loading states
 */
const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread],
  );

  return (
    <Component
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent animate-text-shimmer motion-reduce:animate-none",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        "[background-image:var(--bg),linear-gradient(var(--color-muted-foreground),var(--color-muted-foreground))]",
        className,
      )}
      style={
        // SAFETY: `--spread` and `--shimmer-duration` are CSS custom
        // properties; they're valid inline style keys at runtime, but
        // CSSProperties's type doesn't model arbitrary custom properties, so
        // this asserts past that gap only.
        {
          "--spread": `${dynamicSpread}px`,
          "--shimmer-duration": `${duration}s`,
        } as CSSProperties
      }
    >
      {children}
    </Component>
  );
};

export const Shimmer = memo(ShimmerComponent);
