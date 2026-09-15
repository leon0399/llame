"use client";

import { cn } from "@workspace/ui/lib/utils";
import { motion } from "motion/react";
import { type CSSProperties, memo, useMemo } from "react";

// `motion.create()` builds a fresh component type on every call, so building one
// during render would remount the element — restarting the sweep — on every
// pass. Every tag the shimmer can render as gets its component here instead,
// once for the life of the module.
const MOTION_COMPONENTS = {
  code: motion.create("code"),
  div: motion.create("div"),
  em: motion.create("em"),
  h1: motion.create("h1"),
  h2: motion.create("h2"),
  h3: motion.create("h3"),
  h4: motion.create("h4"),
  h5: motion.create("h5"),
  h6: motion.create("h6"),
  li: motion.create("li"),
  p: motion.create("p"),
  pre: motion.create("pre"),
  small: motion.create("small"),
  span: motion.create("span"),
  strong: motion.create("strong"),
} as const;

/** Intrinsic tags the shimmer can render as; each has a motion component in `MOTION_COMPONENTS`. */
export type ShimmerTag = keyof typeof MOTION_COMPONENTS;

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
  const MotionComponent = MOTION_COMPONENTS[Component];

  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread],
  );

  return (
    <MotionComponent
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        "[background-image:var(--bg),linear-gradient(var(--color-muted-foreground),var(--color-muted-foreground))]",
        className,
      )}
      animate={{ backgroundPosition: "0% center" }}
      initial={{ backgroundPosition: "100% center" }}
      transition={{
        repeat: Number.POSITIVE_INFINITY,
        duration,
        ease: "linear",
      }}
      style={
        // SAFETY: `--spread` is a CSS custom property; it's a valid inline
        // style key at runtime, but CSSProperties's type doesn't model
        // arbitrary custom properties, so this asserts past that gap only.
        {
          "--spread": `${dynamicSpread}px`,
        } as CSSProperties
      }
    >
      {children}
    </MotionComponent>
  );
};

export const Shimmer = memo(ShimmerComponent);
