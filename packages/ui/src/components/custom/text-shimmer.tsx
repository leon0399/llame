"use client";
import React, { useMemo, type JSX } from "react";
import { motion } from "motion/react";
import { cn } from "@workspace/ui/lib/utils";

export type TextShimmerProps = {
  /** Text to render with the shimmer sweep. */
  children: string;
  /** Element (or component) to render as — e.g. `"span"` for inline use within a sentence. */
  as?: React.ElementType;
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
 * TextShimmer renders text with an animated gradient sweep, for an
 * in-progress or loading state shown inline with text (e.g. "Generating
 * response…"). Memoized since its animation is driven by `motion/react`
 * rather than by prop changes.
 *
 * @summary animated shimmering text for in-progress/loading states
 */
function TextShimmerComponent({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) {
  const MotionComponent = motion.create(
    Component as keyof JSX.IntrinsicElements,
  );

  const dynamicSpread = useMemo(() => {
    return children.length * spread;
  }, [children, spread]);

  return (
    <MotionComponent
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text",
        "text-transparent [--base-color:#a1a1aa] [--base-gradient-color:#000]",
        "[background-repeat:no-repeat,padding-box] [--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))]",
        "dark:[--base-color:#71717a] dark:[--base-gradient-color:#ffffff] dark:[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))]",
        className,
      )}
      initial={{ backgroundPosition: "100% center" }}
      animate={{ backgroundPosition: "0% center" }}
      transition={{
        repeat: Infinity,
        duration,
        ease: "linear",
      }}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage: `var(--bg), linear-gradient(var(--base-color), var(--base-color))`,
        } as React.CSSProperties
      }
    >
      {children}
    </MotionComponent>
  );
}

export const TextShimmer = React.memo(TextShimmerComponent);
