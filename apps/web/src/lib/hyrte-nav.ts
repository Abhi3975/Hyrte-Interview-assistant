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
import type { NavItem } from '@/components/dashboard-shell';

export function hyrteNav(sessionId: string): NavItem[] {
  const base = `/hyrte/session/${sessionId}`;
  return [
    { href: base, label: 'Home', icon: createElement(HomeIcon) },
    { href: `${base}/inbox`, label: 'Inbox', icon: createElement(MailIcon) },
    { href: `${base}/slack`, label: 'Slack', icon: createElement(MessageSquareIcon) },
    { href: `${base}/tasks`, label: 'Work Pipeline', icon: createElement(CheckSquareIcon) },
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
