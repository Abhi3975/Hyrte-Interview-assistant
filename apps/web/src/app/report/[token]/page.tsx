'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';
import { ReportView, type ReportEvaluation, type ReportSession } from '@/components/report-view';

interface ReportResponse { evaluation: ReportEvaluation; session: ReportSession }

/**
 * P5 — public, unauthenticated share view. Deliberately NOT wrapped in
 * DashboardShell (which always requires a logged-in user, see
 * dashboard-shell.tsx) — this route's whole purpose is "anyone with the
 * link", so it gets its own minimal chrome instead.
 */
export default function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { data, isLoading, error } = useQuery({
    queryKey: ['shared-report', token],
    queryFn: () => api.get<ReportResponse>(`/evaluation/shared/${token}`),
    retry: false,
  });

  return (
    <div className="min-h-screen bg-white text-black dark:bg-[#0a0e17] dark:text-white">
      <header className="no-print flex items-center justify-between border-b border-black/5 px-6 py-4 dark:border-white/10">
        <span className="text-lg font-bold">HYRTE</span>
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        {isLoading ? (
          <p className="text-sm text-black/50">Loading report…</p>
        ) : error || !data ? (
          <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-500">
            {error instanceof ApiError && error.status === 404 ? 'This link is invalid or has expired.' : 'Could not load this report.'}
          </p>
        ) : (
          <ReportView evaluation={data.evaluation} session={data.session} mode="public" />
        )}
      </main>
    </div>
  );
}
