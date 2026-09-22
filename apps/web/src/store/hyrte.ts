'use client';

import { create } from 'zustand';

/**
 * Live-session signal store. Pages don't cache server state here — they
 * still fetch via React Query — this store just bumps a version counter per
 * resource so a page's `useQuery` can key off it and refetch the instant the
 * `/ws/hyrte` socket reports a change, without polling.
 */

/**
 * Founder feedback (WhatsApp, 7 Sep): "Notification nhi ari thi na slack na
 * inbox etc — jaha bhi jo update hora tha toh pta kuch nhi chlra tha."
 *
 * Websocket events used to ONLY bump the version counters above, which
 * silently refetched a list the candidate was probably not looking at. A real
 * event now also raises a transient toast, so something arriving is visible
 * from wherever you are in the workspace.
 */
export interface HyrteLiveToast {
  id: string;
  source: 'INBOX' | 'SLACK' | 'TASK' | 'MEETING' | 'STATE';
  title: string;
  body: string;
  urgent: boolean;
  href?: string;
}

/** Keeps a burst (e.g. a chaos wave) from covering the screen. */
const MAX_VISIBLE_TOASTS = 4;

interface HyrteState {
  inboxVersion: number;
  slackVersion: number;
  taskVersion: number;
  companyStateVersion: number;
  stakeholderVersion: number;
  meetingVersion: number;
  toasts: HyrteLiveToast[];
  bumpInbox: () => void;
  bumpSlack: () => void;
  bumpTask: () => void;
  bumpCompanyState: () => void;
  bumpStakeholder: () => void;
  bumpMeeting: () => void;
  pushToast: (toast: Omit<HyrteLiveToast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

export const useHyrteStore = create<HyrteState>((set) => ({
  inboxVersion: 0,
  slackVersion: 0,
  taskVersion: 0,
  companyStateVersion: 0,
  stakeholderVersion: 0,
  meetingVersion: 0,
  toasts: [],
  bumpInbox: () => set((s) => ({ inboxVersion: s.inboxVersion + 1 })),
  bumpSlack: () => set((s) => ({ slackVersion: s.slackVersion + 1 })),
  bumpTask: () => set((s) => ({ taskVersion: s.taskVersion + 1 })),
  bumpCompanyState: () => set((s) => ({ companyStateVersion: s.companyStateVersion + 1 })),
  bumpStakeholder: () => set((s) => ({ stakeholderVersion: s.stakeholderVersion + 1 })),
  bumpMeeting: () => set((s) => ({ meetingVersion: s.meetingVersion + 1 })),
  pushToast: (toast) =>
    set((s) => ({
      toasts: [...s.toasts, { ...toast, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }].slice(-MAX_VISIBLE_TOASTS),
    })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
