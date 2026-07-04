import { useState, useEffect } from 'react';

/*
 * Tracks the Tailwind `md` breakpoint so components can mount either a
 * split-view panel (desktop) or a full-screen drawer (mobile) — rendering
 * both and hiding one with CSS would double up realtime subscriptions.
 */
export default function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e) => setIsDesktop(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
