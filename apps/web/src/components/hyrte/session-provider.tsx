'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { useHyrteStore } from '@/store/hyrte';
import { HyrteWsClient, HyrteWsEvent } from '@/lib/hyrte-ws';

/** Shapes the gateway actually puts on the wire — see apps/api/src/hyrte/hyrte.gateway.ts. */
interface WsInboxMessage {
  subject?: string;
  body?: string;
  urgent?: boolean;
}
interface WsSlackMessage {
  channel?: string;
  body?: string;
  fromStakeholderId?: string | null;
}
interface WsWorkItem {
  title?: string;
  stage?: string;
  priority?: string;
}

function truncate(text: string, max = 110): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Opens the `/ws/hyrte` socket once for the whole `/hyrte/session/:id` route
 * subtree and translates each incoming event into a store version bump —
 * individual pages just useQuery keyed on that version, they never touch the
 * socket directly.
 *
 * Founder feedback (WhatsApp, 7 Sep) — "notification nhi ari thi na slack na
 * inbox etc": a version bump alone is invisible. Every event now ALSO raises a
 * toast (see LiveToasts) and invalidates the Activity Center feed so the bell
 * and the sidebar badges update the moment something lands, wherever the
 * candidate happens to be.
 */
export function HyrteSessionProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: React.ReactNode;
}) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { bumpInbox, bumpSlack, bumpTask, bumpCompanyState, bumpStakeholder, bumpMeeting, pushToast } = useHyrteStore();
  const queryClient = useQueryClient();
  const clientRef = useRef<HyrteWsClient | null>(null);
  const base = `/hyrte/session/${sessionId}`;

  useEffect(() => {
    if (!accessToken) return;

    const client = new HyrteWsClient();
    clientRef.current = client;
    client.connect(accessToken, sessionId, (msg: HyrteWsEvent) => {
      // Every event moves the Activity Center, regardless of which surface it
      // landed on — that panel is the one place that answers "what's new".
      queryClient.invalidateQueries({ queryKey: ['hyrte', 'activity', sessionId] });

      switch (msg.type) {
        case 'inbox:new': {
          const m = msg.message as WsInboxMessage | undefined;
          pushToast({
            source: 'INBOX',
            title: m?.subject ? truncate(m.subject, 60) : 'New message',
            body: truncate(m?.body ?? 'Something new landed in your inbox.'),
            urgent: !!m?.urgent,
            href: `${base}/inbox`,
          });
          return bumpInbox();
        }
        case 'slack:new': {
          const m = msg.message as WsSlackMessage | undefined;
          // The candidate's own posts echo back over the socket — don't
          // notify someone about a message they just sent.
          if (m && m.fromStakeholderId === null) return bumpSlack();
          const isDm = !!m?.channel?.startsWith('dm:');
          pushToast({
            source: 'SLACK',
            title: isDm ? 'Direct message' : m?.channel ?? 'Slack',
            body: truncate(m?.body ?? 'New message in Slack.'),
            urgent: isDm,
            href: `${base}/slack${m?.channel ? `?channel=${encodeURIComponent(m.channel)}` : ''}`,
          });
          return bumpSlack();
        }
        case 'task:update': {
          const t = msg.task as WsWorkItem | undefined;
          // Only the stage that genuinely needs the candidate is worth
          // interrupting for — intermediate stage churn is what the Work
          // Pipeline board is for.
          if (t?.stage === 'WAITING_REVIEW') {
            pushToast({
              source: 'TASK',
              title: 'Waiting on your review',
              body: truncate(t.title ?? 'A colleague finished a piece of work.'),
              urgent: t.priority === 'HIGH' || t.priority === 'CRITICAL',
              href: `${base}/needs-review`,
            });
          }
          return bumpTask();
        }
        case 'company_state:update':
          return bumpCompanyState();
        case 'stakeholder:update':
          return bumpStakeholder();
        case 'meeting:new':
          pushToast({ source: 'MEETING', title: 'Meeting starting', body: 'A meeting on your calendar is beginning.', urgent: true, href: `${base}/meetings` });
          return bumpMeeting();
        case 'meeting:concluded':
          return bumpMeeting();
      }
    });

    return () => client.close();
  }, [accessToken, sessionId, base, queryClient, bumpInbox, bumpSlack, bumpTask, bumpCompanyState, bumpStakeholder, bumpMeeting, pushToast]);

  return <>{children}</>;
}
