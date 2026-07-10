'use client';

import { DashboardShell } from '@/components/dashboard-shell';

export default function CandidateDashboard() {
  return (
    <DashboardShell area="candidate" title="Candidate Dashboard" requiredRoles={['CANDIDATE']}>
      <div className="grid gap-5 sm:grid-cols-3">
        <Stat label="Interviews taken" value="0" />
        <Stat label="Avg. score" value="—" />
        <Stat label="Next scheduled" value="None" />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="card">
          <h3 className="font-semibold">Get interview-ready</h3>
          <ol className="mt-3 space-y-2 text-sm text-black/60 dark:text-white/60">
            <li>1. Upload your resume so the AI can personalize questions.</li>
            <li>2. Select your target skills & role.</li>
            <li>3. Wait for a recruiter to unlock your assessment.</li>
            <li>4. Pass identity verification, then start.</li>
          </ol>
          <a href="/candidate/resume" className="btn-primary mt-4 inline-flex">Upload resume</a>
        </div>
        <div className="card">
          <h3 className="font-semibold">Available interviews</h3>
          <p className="mt-3 text-sm text-black/60 dark:text-white/60">
            No interviews yet. Assessments assigned by recruiters will appear here once approved.
          </p>
        </div>
      </div>
    </DashboardShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-sm text-black/50 dark:text-white/50">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
