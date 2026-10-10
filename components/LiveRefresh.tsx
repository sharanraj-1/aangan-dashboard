'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Quietly re-fetches server data every `seconds` so the dashboard stays current. Pauses when the tab is hidden. */
export function LiveRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return (
    <span className="ml-1 hidden items-center gap-1.5 text-xs text-faint sm:inline-flex" title={`Updates automatically every ${seconds} seconds`}>
      <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden /> Live
    </span>
  );
}
