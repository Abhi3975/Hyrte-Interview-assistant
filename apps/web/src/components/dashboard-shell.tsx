'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuthStore, Role } from '@/store/auth';
import { ThemeToggle } from './theme-toggle';

interface NavItem {
  href: string;
  label: string;
}

const NAV: Record<'candidate' | 'recruiter' | 'admin', NavItem[]> = {
  candidate: [
    { href: '/candidate', label: 'Dashboard' },
    { href: '/candidate/interview', label: 'AI Interview Room' },
    { href: '/candidate/practice', label: 'Mock Interview' },
    { href: '/candidate/live', label: 'Live Interview' },
    { href: '/candidate/interviews', label: 'Interviews' },
    { href: '/candidate/resume', label: 'Resume & Skills' },
    { href: '/candidate/reports', label: 'Reports' },
  ],
  recruiter: [
    { href: '/recruiter', label: 'Dashboard' },
    { href: '/recruiter/interviews', label: 'Assessments' },
    { href: '/recruiter/questions', label: 'Question Bank' },
    { href: '/recruiter/proctoring', label: 'Live Proctoring' },
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
}: {
  area: 'candidate' | 'recruiter' | 'admin';
  title: string;
  children: React.ReactNode;
  requiredRoles?: Role[];
}) {
  const router = useRouter();
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

  // Avoid flashing protected content before the auth check resolves.
  if (!hydrated || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-black/50 dark:text-white/50">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-black/5 p-4 dark:border-white/10 md:block">
        <Link href="/" className="mb-6 block text-lg font-bold">
          Interview<span className="text-brand-500">AI</span>
        </Link>
        <nav className="space-y-1">
          {NAV[area].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-lg px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-black/5 px-6 py-4 dark:border-white/10">
          <h1 className="text-lg font-semibold">{title}</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-black/50 dark:text-white/50">{user?.fullName}</span>
            <ThemeToggle />
            <button onClick={logout} className="btn-ghost text-sm">Log out</button>
          </div>
        </header>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
