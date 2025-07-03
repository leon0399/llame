import { useRef, useEffect, useLayoutEffect } from 'react';

export function useAutoResizeTextarea({
  maxHeight,
  minHeight,
}: {
  maxHeight?: number;
  minHeight?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;

    // Reset to auto to measure correct scrollHeight
    el.style.height = 'auto';

    let newHeight = el.scrollHeight;

    if (typeof minHeight === 'number') {
      newHeight = Math.max(newHeight, minHeight);
    }
    if (typeof maxHeight === 'number') {
      newHeight = Math.min(newHeight, maxHeight);
    }

    el.style.height = `${newHeight}px`;
  };

  // Resize on every user input
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    // Bind once
    el.addEventListener('input', resize);

    // Safety: resize once in case value was prefilled
    resize();

    // Cleanup
    return () => {
      el.removeEventListener('input', resize);
    };
  }, [minHeight, maxHeight]); // Re-bind listener if bounds change

  // Resize on first paint & whenever bounds change (sync with layout)
  useLayoutEffect(resize, [minHeight, maxHeight]);

  return textareaRef;
}
