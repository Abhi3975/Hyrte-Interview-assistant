import {
  HomeIcon,
  MailIcon,
  MessageSquareIcon,
  CheckSquareIcon,
  CalendarIcon,
  BookOpenIcon,
  BarChartIcon,
  UsersIcon,
  ClockIcon,
  HelpCircleIcon,
  ClipboardIcon,
  CheckIcon,
} from '@/components/icons';
import { MeetingIcon } from '@/components/hyrte-os/icons';
import { createElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useHyrteStore } from '@/store/hyrte';
import type { HyrteActivityFeed } from '@/lib/hyrte-types';
import type { NavItem } from '@/components/dashboard-shell';

export function hyrteNav(sessionId: string): NavItem[] {
  const base = `/hyrte/session/${sessionId}`;
  return [
    { href: base, label: 'Home', icon: createElement(HomeIcon) },
    { href: `${base}/inbox`, label: 'Inbox', icon: createElement(MailIcon) },
    { href: `${base}/slack`, label: 'Slack', icon: createElement(MessageSquareIcon) },
    // Refinements doc §11 — My Tasks is what the candidate is actually
    // responsible for; the Work Pipeline below it is the wider board of
    // everything in flight, including other people's work.
    { href: `${base}/my-tasks`, label: 'My Tasks', icon: createElement(CheckSquareIcon) },
    { href: `${base}/tasks`, label: 'Work Pipeline', icon: createElement(ClipboardIcon) },
    { href: `${base}/needs-review`, label: 'Needs Review', icon: createElement(CheckIcon) },
    { href: `${base}/calendar`, label: 'Calendar', icon: createElement(CalendarIcon) },
    { href: `${base}/meetings`, label: 'Meetings', icon: createElement(MeetingIcon) },
    { href: `${base}/knowledge-base`, label: 'Knowledge Base', icon: createElement(BookOpenIcon) },
    { href: `${base}/analytics`, label: 'Analytics', icon: createElement(BarChartIcon) },
    { href: `${base}/stakeholders`, label: 'Stakeholders', icon: createElement(UsersIcon) },
    { href: `${base}/decision-log`, label: 'Decision Log', icon: createElement(ClockIcon) },
    { href: `${base}/interview`, label: 'Interview', icon: createElement(HelpCircleIcon) },
    { href: `${base}/report`, label: 'Report', icon: createElement(ClipboardIcon) },
  ];
}

/**
 * Founder feedback (WhatsApp, 7 Sep) — "notification nhi ari thi na slack na
 * inbox etc, jaha bhi jo update hora tha toh pta kuch nhi chlra tha."
 *
 * The same nav, with live unread counts on the surfaces that have them. Before
 * this there was no count anywhere in the workspace: a message could land in
 * Slack or a colleague could finish a piece of work and the sidebar looked
 * exactly the same as before. Shares its query key with the Activity Center, so
 * both update from one fetch and from the same websocket-driven invalidation.
 */
export function useHyrteNav(sessionId: string): NavItem[] {
  const { inboxVersion, slackVersion, taskVersion, meetingVersion } = useHyrteStore();
  const { data } = useQuery({
    queryKey: ['hyrte', 'activity', sessionId, inboxVersion, slackVersion, taskVersion, meetingVersion],
    queryFn: () => api.get<HyrteActivityFeed>(`/hyrte/sessions/${sessionId}/activity`),
    refetchInterval: 20_000,
  });
  const counts = data?.counts;
  if (!counts) return hyrteNav(sessionId);

  const badges: Record<string, number> = {
    Inbox: counts.inbox,
    Slack: counts.slack,
    Meetings: counts.meetings,
    'Needs Review': counts.needsReview,
  };
  return hyrteNav(sessionId).map((item) => (badges[item.label] ? { ...item, badge: badges[item.label] } : item));
}
