'use client';

/**
 * G0 static preview — Team Console, for side-by-side design review only.
 * All data below is hardcoded mock content. Not wired to any API, not linked
 * from app nav, not part of the real candidate session flow.
 */

import '../hyrte-os.css';
import { StatusPill } from '@/components/hyrte-os/status-pill';
import { MetricCounter } from '@/components/hyrte-os/metric-counter';
import { LiveCard } from '@/components/hyrte-os/live-card';
import { CommandBar } from '@/components/hyrte-os/command-bar';
import {
  GridIcon,
  MailIcon,
  ChatIcon,
  PipelineIcon,
  CalendarIcon,
  MeetingIcon,
  BookIcon,
  ChartIcon,
  CrownIcon,
  BellIcon,
} from '@/components/hyrte-os/icons';

const NAV = [
  { icon: GridIcon, label: 'Command Center' },
  { icon: MailIcon, label: 'Inbox', badge: 3 },
  { icon: ChatIcon, label: 'Chat', badge: 1 },
  { icon: PipelineIcon, label: 'Work Pipeline' },
  { icon: CalendarIcon, label: 'Calendar' },
  { icon: MeetingIcon, label: 'Meetings' },
  { icon: BookIcon, label: 'Knowledge Vault' },
  { icon: ChartIcon, label: 'Analytics' },
];

const TEAM = [
  { name: 'Priya Nair', role: 'CEO', status: 'working' as const },
  { name: 'Kabir Malhotra', role: 'Engineering Lead', status: 'working' as const },
  { name: 'Sana Fernandes', role: 'Sales Lead', status: 'waiting' as const },
  { name: 'Elena Cho', role: 'Product Designer', status: 'idle' as const },
  { name: 'David Osei', role: 'CFO', status: 'escalating' as const },
];

const SPECIALISTS = [
  {
    name: 'Kabir Malhotra',
    dept: 'ENGINEERING',
    color: 'var(--hos-cyan)',
    status: 'working' as const,
    focus: 'Scoping the analytics dashboard rebuild — blocked on the API contract your team owns.',
    footer: '4 open items',
  },
  {
    name: 'Sana Fernandes',
    dept: 'SALES',
    color: 'var(--hos-purple)',
    status: 'waiting' as const,
    focus: "Chasing Acme Corp for the renewal signature. Trust is declining — escalation risk rising.",
    footer: '2 open items',
  },
  {
    name: 'Elena Cho',
    dept: 'DESIGN',
    color: 'var(--hos-pink)',
    status: 'idle' as const,
    focus: 'Wrapping up onboarding flow mocks for next sprint. Nothing blocking right now.',
    footer: '1 open item',
  },
  {
    name: 'David Osei',
    dept: 'FINANCE',
    color: 'var(--hos-orange)',
    status: 'escalating' as const,
    focus: 'Flagged Q3 burn rate. Wants a budget review meeting before Friday.',
    footer: '3 open items',
  },
];

export default function TeamConsolePreview() {
  return (
    <div className="hyrte-os flex">
      {/* Sidebar */}
      <aside
        className="hidden w-64 shrink-0 flex-col gap-6 border-r p-4 md:flex"
        style={{ borderColor: 'var(--hos-border)' }}
      >
        <div>
          <div className="text-[15px] font-semibold">HYRTE</div>
          <div className="hos-body">Solstice — B2B analytics SaaS</div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map(({ icon: Icon, label, badge }) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-lg px-2.5 py-2 text-[13px]"
              style={
                label === 'Command Center'
                  ? { background: 'var(--hos-accent-glow)', color: 'var(--hos-accent)' }
                  : { color: 'var(--hos-text-muted)' }
              }
            >
              <span className="flex items-center gap-2">
                <Icon width={16} height={16} />
                {label}
              </span>
              {badge && (
                <span
                  className="rounded-full px-1.5 text-[10px] font-medium"
                  style={{ background: 'var(--hos-accent-glow)', color: 'var(--hos-accent)' }}
                >
                  {badge}
                </span>
              )}
            </div>
          ))}
        </nav>

        <div className="mt-2 flex flex-col gap-2">
          <span className="hos-micro-label" style={{ color: 'var(--hos-text-dim)' }}>
            Team
          </span>
          {TEAM.map((t) => (
            <div key={t.name} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold"
                style={{ background: 'var(--hos-card-bg-hover)' }}
              >
                {t.name.split(' ').map((n) => n[0]).join('')}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium">{t.name}</div>
                <div className="hos-body truncate">{t.role}</div>
              </div>
              <StatusPill status={t.status} label="" />
            </div>
          ))}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-6">
        {/* Top bar */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-[16px] font-semibold">Team Console</div>
            <div className="hos-body">Who's doing what, right now</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hos-chip">Day 2 · 11:42 AM</span>
            <span className="hos-chip" style={{ color: 'var(--hos-waiting)', borderColor: 'var(--hos-waiting)' }}>
              tense
            </span>
            <BellIcon width={18} height={18} style={{ color: 'var(--hos-text-muted)' }} />
          </div>
        </div>

        {/* Manager hero card */}
        <div className="hos-card mb-4 p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-lg"
                style={{ background: 'var(--hos-accent-glow)', color: 'var(--hos-accent)' }}
              >
                <CrownIcon width={22} height={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="hos-card-title">Priya Nair</span>
                  <StatusPill status="working" />
                </div>
                <span className="hos-micro-label" style={{ color: 'var(--hos-accent)' }}>
                  CEO / YOUR MANAGER
                </span>
              </div>
            </div>
          </div>
          <p className="hos-body mt-3 max-w-xl">
            Reviewing the Q3 renewal pipeline ahead of Friday's board deck. Watching the Acme Corp
            account closely — wants a status update from you before end of day.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-4 border-t pt-4" style={{ borderColor: 'var(--hos-border)' }}>
            {[
              ['Open Threads', 7],
              ['Decisions Today', 3],
              ['Waiting On You', 2],
            ].map(([label, val]) => (
              <div key={label as string}>
                <MetricCounter value={val as number} />
                <div className="hos-micro-label mt-0.5" style={{ color: 'var(--hos-text-dim)' }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Specialist grid */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SPECIALISTS.map((s) => (
            <LiveCard key={s.name} footer={<span className="hos-chip">{s.footer} · {s.dept}</span>}>
              <div className="flex items-center justify-between">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-md text-[12px] font-semibold"
                  style={{ background: `${s.color}22`, color: s.color }}
                >
                  {s.name.split(' ').map((n) => n[0]).join('')}
                </div>
                <StatusPill status={s.status} />
              </div>
              <div>
                <div className="hos-card-title">{s.name}</div>
                <span className="hos-micro-label" style={{ color: s.color }}>
                  {s.dept}
                </span>
              </div>
              <p className="hos-body">{s.focus}</p>
            </LiveCard>
          ))}
        </div>

        {/* Command bar */}
        <CommandBar />
      </main>
    </div>
  );
}
