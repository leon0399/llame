"use client";

import { useEffect, useRef } from "react";

import { GlyphField as GlyphFieldRenderer } from "@/lib/glyph-field";

// Fades the field in under the top bar (opaque from 12% down) and out above
// the composer (from 75% down), as two edge masks.
const EDGE_FADE = "mask-t-from-88% mask-b-from-75%";

/**
 * The new-chat page's background: an animated, theme-inked glyph field (see
 * lib/glyph-field.ts) filling its positioned parent, faded out at the top
 * and bottom edges. Decorative only — hidden from assistive tech and
 * click-through.
 */
export function GlyphField() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const field = GlyphFieldRenderer.mount(host);
    return () => field?.destroy();
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      // font-mono: the renderer reads the resolved mono face off the host.
      className={`pointer-events-none absolute inset-0 overflow-hidden font-mono text-foreground ${EDGE_FADE}`}
    />
  );
}
