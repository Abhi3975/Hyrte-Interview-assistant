'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { HyrteSession } from '@/lib/hyrte-types';

/** Which screen a given pre-workspace phase must be on. */
const PHASE_SCREENS: Record<string, string> = {
  GENERATING: 'mission-brief',
  MISSION_BRIEF: 'mission-brief',
  BASELINE_SKILL_CHECK: 'baseline-challenge',
};

/**
 * UX flow §8 steps 1-2 gate: redirects into the Mission Brief / Baseline
 * Challenge screen while the session hasn't reached WORKSPACE_ACTIVE yet, and
 * away from them once it has. Renders nothing — pure side-effect component,
 * mounted once for the whole `/hyrte/session/:id` route subtree.
 */
export function HyrtePhaseGate({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useQuery({
    queryKey: ['hyrte', 'session', sessionId],
    queryFn: () => api.get<HyrteSession>(`/hyrte/sessions/${sessionId}`),
  });

  useEffect(() => {
    if (!session) return;
    const requiredSlug = PHASE_SCREENS[session.phase];
    const base = `/hyrte/session/${sessionId}`;

    if (requiredSlug && pathname !== `${base}/${requiredSlug}`) {
      router.replace(`${base}/${requiredSlug}`);
    } else if (!requiredSlug && (pathname.endsWith('/mission-brief') || pathname.endsWith('/baseline-challenge'))) {
      router.replace(base);
    }
  }, [session, pathname, sessionId, router]);

  return null;
}
