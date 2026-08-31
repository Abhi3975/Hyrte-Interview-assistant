'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuthStore, Role } from '@/store/auth';
import { ThemeToggle } from './theme-toggle';
import { ArrowLeftIcon } from './icons';

export interface NavItem {
  href: string;
  label: string;
  icon?: React.ReactNode;
}

const NAV: Record<'candidate' | 'recruiter' | 'admin' | 'hyrte', NavItem[]> = {
  hyrte: [], // HYRTE nav is session-scoped; always passed via `navOverride` instead.
  candidate: [
    { href: '/candidate', label: 'Dashboard' },
    { href: '/candidate/interview', label: 'AI Interview Room' },
    { href: '/candidate/practice', label: 'Mock Interview' },
    { href: '/candidate/live', label: 'Live Interview' },
    { href: '/candidate/interviews', label: 'Interviews' },
    { href: '/hyrte', label: 'HYRTE Simulation' },
    { href: '/candidate/resume', label: 'Resume & Skills' },
    { href: '/candidate/reports', label: 'Reports' },
  ],
  recruiter: [
    { href: '/recruiter', label: 'Dashboard' },
    { href: '/recruiter/interviews', label: 'Assessments' },
    { href: '/recruiter/questions', label: 'Question Bank' },
    { href: '/recruiter/proctoring', label: 'Live Proctoring' },
    { href: '/recruiter/council', label: 'Decision Council' },
    { href: '/recruiter/hyrte-live', label: 'HYRTE Live Console' },
    { href: '/recruiter/hyrte-sessions/new', label: 'New HYRTE Session' },
  ],
  admin: [
    { href: '/admin', label: 'Overview' },
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/companies', label: 'Companies' },
    { href: '/admin/security', label: 'Security & Audit' },
  ],
};

export function DashboardShell({
  area,
  title,
  children,
  requiredRoles,
  navOverride,
  sidebarExtra,
  backHref,
  backLabel = 'Back',
  variant = 'default',
}: {
  area: 'candidate' | 'recruiter' | 'admin' | 'hyrte';
  title: string;
  children: React.ReactNode;
  requiredRoles?: Role[];
  navOverride?: NavItem[];
  /** Extra content rendered in the sidebar below the logo (e.g. session context). */
  sidebarExtra?: React.ReactNode;
  /** Shows a back button in the header when set. */
  backHref?: string;
  backLabel?: string;
  /**
   * 'hyrte-os' rolls out the G0-approved dark "agentic OS" mockup — the
   * candidate workspace and the Recruiter Live Console both opt in (Part
   * E3: "same design system"), everything else stays on the default
   * brand-blue shell. Forces dark mode locally (see globals.css) since the
   * reference has no light variant.
   */
  variant?: 'default' | 'hyrte-os';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  // The persisted session rehydrates from localStorage just after mount. We
  // must wait for hydration before deciding to redirect, otherwise a hard
  // refresh momentarily sees `user === null` and bounces to /login.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAuthStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) router.replace('/login');
    else if (requiredRoles && !requiredRoles.includes(user.role)) router.replace('/');
  }, [hydrated, user, requiredRoles, router]);

  const osClass = variant === 'hyrte-os' ? 'hyrte-os dark' : '';

  // Avoid flashing protected content before the auth check resolves.
  if (!hydrated || !user) {
    return (
      <div className={`flex h-screen items-center justify-center text-sm text-black/50 dark:text-white/50 ${osClass}`}>
        Loading…
      </div>
    );
  }

  const items = navOverride ?? NAV[area];

  return (
    <div className={`flex h-screen overflow-hidden ${osClass}`}>
      <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-black/5 p-4 dark:border-white/10 md:flex">
        <Link href="/" className="mb-6 block text-lg font-bold">
          HYRTE
        </Link>

        {sidebarExtra}

        <nav className="space-y-0.5">
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? 'bg-brand-500/10 font-medium text-brand-600 dark:text-brand-400'
                    : 'text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/5'
                }`}
              >
                {item.icon && <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{item.icon}</span>}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-black/5 px-6 py-4 dark:border-white/10">
          <div className="flex items-center gap-3">
            {backHref && (
              <Link
                href={backHref}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/5"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                {backLabel}
              </Link>
            )}
            <h1 className="text-lg font-semibold">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-black/50 dark:text-white/50 sm:inline">{user?.fullName}</span>
            {variant !== 'hyrte-os' && <ThemeToggle />}
            <button onClick={logout} className="btn-ghost text-sm">Log out</button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
