'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth';
import { useHyrteStore } from '@/store/hyrte';
import { HyrteWsClient, HyrteWsEvent } from '@/lib/hyrte-ws';

/**
 * Opens the `/ws/hyrte` socket once for the whole `/hyrte/session/:id` route
 * subtree and translates each incoming event into a store version bump —
 * individual pages just useQuery keyed on that version, they never touch the
 * socket directly.
 */
export function HyrteSessionProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: React.ReactNode;
}) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { bumpInbox, bumpSlack, bumpTask, bumpCompanyState, bumpStakeholder, bumpMeeting } = useHyrteStore();
  const clientRef = useRef<HyrteWsClient | null>(null);

  useEffect(() => {
    if (!accessToken) return;

    const client = new HyrteWsClient();
    clientRef.current = client;
    client.connect(accessToken, sessionId, (msg: HyrteWsEvent) => {
      switch (msg.type) {
        case 'inbox:new':
          return bumpInbox();
        case 'slack:new':
          return bumpSlack();
        case 'task:update':
          return bumpTask();
        case 'company_state:update':
          return bumpCompanyState();
        case 'stakeholder:update':
          return bumpStakeholder();
        case 'meeting:new':
        case 'meeting:concluded':
          return bumpMeeting();
      }
    });

    return () => client.close();
  }, [accessToken, sessionId, bumpInbox, bumpSlack, bumpTask, bumpCompanyState, bumpStakeholder, bumpMeeting]);

  return <>{children}</>;
}
