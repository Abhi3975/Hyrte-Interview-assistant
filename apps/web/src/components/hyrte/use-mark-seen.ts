'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Refinements doc §4 — the write half of the Activity Center. Inbox messages
 * have their own per-message `readAt`, but Slack, meetings and work items have
 * no read state in the schema at all, so "new since I last looked" had nothing
 * to compute from. Opening one of those surfaces stamps it seen, which is what
 * clears its sidebar badge and drops it out of the bell's unread count.
 *
 * `dep` should be the surface's own live version counter, so arriving at a page
 * and then receiving a new message while sitting on it both re-stamp.
 */
export function useMarkActivitySeen(sessionId: string, surface: 'slack' | 'meetings' | 'tasks', dep: unknown) {
  const queryClient = useQueryClient();
  useEffect(() => {
    let cancelled = false;
    api
      .patch(`/hyrte/sessions/${sessionId}/activity/seen/${surface}`, {})
      .then(() => {
        if (!cancelled) queryClient.invalidateQueries({ queryKey: ['hyrte', 'activity', sessionId] });
      })
      // A failed stamp only means a badge lingers — never worth breaking the page over.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId, surface, dep, queryClient]);
}
