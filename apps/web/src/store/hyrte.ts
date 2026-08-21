'use client';

import { create } from 'zustand';

/**
 * Live-session signal store. Pages don't cache server state here — they
 * still fetch via React Query — this store just bumps a version counter per
 * resource so a page's `useQuery` can key off it and refetch the instant the
 * `/ws/hyrte` socket reports a change, without polling.
 */
interface HyrteState {
  inboxVersion: number;
  slackVersion: number;
  taskVersion: number;
  companyStateVersion: number;
  stakeholderVersion: number;
  meetingVersion: number;
  bumpInbox: () => void;
  bumpSlack: () => void;
  bumpTask: () => void;
  bumpCompanyState: () => void;
  bumpStakeholder: () => void;
  bumpMeeting: () => void;
}

export const useHyrteStore = create<HyrteState>((set) => ({
  inboxVersion: 0,
  slackVersion: 0,
  taskVersion: 0,
  companyStateVersion: 0,
  stakeholderVersion: 0,
  meetingVersion: 0,
  bumpInbox: () => set((s) => ({ inboxVersion: s.inboxVersion + 1 })),
  bumpSlack: () => set((s) => ({ slackVersion: s.slackVersion + 1 })),
  bumpTask: () => set((s) => ({ taskVersion: s.taskVersion + 1 })),
  bumpCompanyState: () => set((s) => ({ companyStateVersion: s.companyStateVersion + 1 })),
  bumpStakeholder: () => set((s) => ({ stakeholderVersion: s.stakeholderVersion + 1 })),
  bumpMeeting: () => set((s) => ({ meetingVersion: s.meetingVersion + 1 })),
}));
