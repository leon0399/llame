"use client";

import { cn } from "@workspace/ui/lib/utils";
import { motion } from "motion/react";
import {
  type CSSProperties,
  type ElementType,
  type JSX,
  memo,
  useMemo,
} from "react";

export type TextShimmerProps = {
  /** Text to render with the shimmer sweep. */
  children: string;
  /** Element (or component) to render as — e.g. `"span"` for inline use within a sentence. */
  as?: ElementType;
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
 * from [AI Elements Shimmer](https://elements.ai-sdk.dev/components/shimmer).
 * Memoized since its animation is driven by `motion/react` rather than by
 * prop changes.
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
  // SAFETY: motion.create dispatches on the actual runtime value (string tag
  // vs. component) regardless of this cast; it only routes TS's generic
  // inference past `ElementType`'s union-in-call-position ambiguity.
  const MotionComponent = motion.create(
    Component as keyof JSX.IntrinsicElements,
  );

  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread],
  );

  return (
    <MotionComponent
      animate={{ backgroundPosition: "0% center" }}
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className,
      )}
      initial={{ backgroundPosition: "100% center" }}
      style={
        // SAFETY: `--spread` is a CSS custom property; it's a valid inline
        // style key at runtime, but CSSProperties's type doesn't model
        // arbitrary custom properties, so this asserts past that gap only.
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage:
            "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
        } as CSSProperties
      }
      transition={{
        repeat: Number.POSITIVE_INFINITY,
        duration,
        ease: "linear",
      }}
    >
      {children}
    </MotionComponent>
  );
};

export const Shimmer = memo(ShimmerComponent);
