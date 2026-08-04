import { HyrteInboxMessage, HyrteStakeholder } from './hyrte-types';

export type LiveStatus = 'working' | 'waiting' | 'idle' | 'escalating';

export const STATUS_DOT: Record<LiveStatus, string> = {
  working: 'bg-emerald-500',
  waiting: 'bg-amber-500',
  idle: 'bg-black/20 dark:bg-white/20',
  escalating: 'bg-red-500',
};

export const STATUS_LABEL: Record<LiveStatus, string> = {
  working: 'Working',
  waiting: 'Waiting on you',
  idle: 'Idle',
  escalating: 'Escalating',
};

/**
 * Single source of truth for a stakeholder's live status — used by both the
 * TEAM rail and Chat's presence dots (Part E2: "presence synced with TEAM
 * rail"), so the two can never silently drift apart. Derived entirely from
 * real data already visible to the candidate (unread/urgent inbox,
 * generation-time currentTasks) — never a fabricated timer, never the
 * trust/emotion internals Hard Rule #5 keeps off candidate payloads. Inbox
 * is the only surface with read-tracking; Slack has none, so it's
 * intentionally not part of this signal.
 */
export function deriveStakeholderStatus(stakeholder: HyrteStakeholder, inbox: HyrteInboxMessage[] | undefined): LiveStatus {
  const unreadFromThem = (inbox ?? []).filter((m) => m.fromStakeholder?.name === stakeholder.name && m.readAt === null);
  if (unreadFromThem.some((m) => m.urgent)) return 'escalating';
  if (unreadFromThem.length > 0) return 'waiting';
  if (stakeholder.currentTasks.length > 0) return 'working';
  return 'idle';
}
