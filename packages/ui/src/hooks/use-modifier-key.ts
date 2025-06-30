import { useEffect, useState } from 'react';

export function detectPrimaryModifier(): '⌘' | 'Ctrl' {
  if (typeof navigator === 'undefined') return 'Ctrl';

  if (navigator.userAgentData?.platform) {
    if (/mac/i.test(navigator.userAgentData.platform)) return '⌘';
  }

  const platform = navigator.platform || navigator.userAgent;
  return /Mac|iPhone|iPod|iPad/i.test(platform) ? '⌘' : 'Ctrl';
}

export function usePrimaryModifierKey() {
  const [key, setKey] = useState<'⌘' | 'Ctrl'>('Ctrl');

  useEffect(() => {
    setKey(detectPrimaryModifier());
  }, []);

  return key;
}