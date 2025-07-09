import { useLayoutEffect, useRef, useCallback } from 'react';

interface UseAutoResizeTextareaOptions {
  minHeight?: number; // optional min height in px
  maxHeight?: number; // optional max height in px
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

    ta.style.height = 'auto';

    let scrollHeight = ta.scrollHeight;

    // Apply minHeight if defined
    if (typeof minHeight === 'number') {
      scrollHeight = Math.max(scrollHeight, minHeight);
    }

    // Apply maxHeight if defined
    if (typeof maxHeight === 'number') {
      scrollHeight = Math.min(scrollHeight, maxHeight);
    }

    ta.style.height = `${scrollHeight}px`;
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

    window.addEventListener('resize', scheduleResize);
    ta.addEventListener('input', onInput);

    return () => {
      window.removeEventListener('resize', scheduleResize);
      ta.removeEventListener('input', onInput);
      if (frameId.current !== null) {
        cancelAnimationFrame(frameId.current);
      }
    };
  }, [resize, scheduleResize]);

  return textareaRef;
}
