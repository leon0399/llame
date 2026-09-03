import { useLayoutEffect, useRef, useCallback } from "react";

interface UseAutoResizeTextareaOptions {
  minHeight?: number; // optional min height in px
  maxHeight?: number; // optional max height in px
}

function applyAutoResize(
  textarea: HTMLTextAreaElement,
  minHeight: number | undefined,
  maxHeight: number | undefined,
): void {
  textarea.style.height = "auto";

  let scrollHeight = textarea.scrollHeight;

  if (minHeight !== undefined) {
    scrollHeight = Math.max(scrollHeight, minHeight);
  }

  if (maxHeight !== undefined) {
    scrollHeight = Math.min(scrollHeight, maxHeight);
  }

  textarea.style.height = `${scrollHeight}px`;
}

export function useAutoResizeTextarea({
  minHeight,
  maxHeight,
}: UseAutoResizeTextareaOptions = {}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const frameId = useRef<number | null>(null);

  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    applyAutoResize(ta, minHeight, maxHeight);
  }, [minHeight, maxHeight]);

  const scheduleResize = useCallback(() => {
    if (frameId.current !== null) {
      cancelAnimationFrame(frameId.current);
    }
    frameId.current = window.requestAnimationFrame(() => {
      resize();
      frameId.current = null;
    });
  }, [resize]);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;

    resize();

    const onInput = () => {
      scheduleResize();
    };

    window.addEventListener("resize", scheduleResize);
    ta.addEventListener("input", onInput);

    return () => {
      window.removeEventListener("resize", scheduleResize);
      ta.removeEventListener("input", onInput);
      if (frameId.current !== null) {
        cancelAnimationFrame(frameId.current);
      }
    };
  }, [resize, scheduleResize]);

  return textareaRef;
}
