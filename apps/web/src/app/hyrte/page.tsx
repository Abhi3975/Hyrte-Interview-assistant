'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard-shell';
import { api, ApiError } from '@/lib/api';

const ROLES = ['Product Manager', 'Software Engineer', 'Sales Executive', 'HR', 'Finance', 'Marketing'];
const EXPERIENCE_LEVELS = ['Intern', 'Junior', 'Mid', 'Senior', 'Lead/Manager'];
const INDUSTRIES = ['SaaS', 'Healthcare', 'E-commerce', 'Manufacturing', 'Banking'];
const COMPANY_TYPES = ['Startup', 'SME', 'Enterprise', 'Consulting', 'Government'];
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'];
const CULTURES = [
  'Customer-obsessed',
  'Engineering-driven',
  'Data-driven',
  'Sales-driven',
  'Innovation-first',
  'Cost-conscious',
  'Compliance-first',
];

interface HyrteSession {
  id: string;
}

export default function HyrteEntry() {
  const router = useRouter();
  const [role, setRole] = useState(ROLES[0]);
  const [experienceLevel, setExperienceLevel] = useState(EXPERIENCE_LEVELS[2]);
  const [industry, setIndustry] = useState(INDUSTRIES[0]);
  const [companyType, setCompanyType] = useState(COMPANY_TYPES[0]);
  const [difficulty, setDifficulty] = useState(DIFFICULTIES[1]);
  const [culture, setCulture] = useState(CULTURES[0]);
  const [jobDescriptionText, setJobDescriptionText] = useState('');
  const [companyContext, setCompanyContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setLoading(true);
    setError('');
    try {
      const session = await api.post<HyrteSession>('/hyrte/sessions', {
        role,
        experienceLevel,
        industry,
        companyType,
        difficulty,
        culture,
      });
      // §0/§3.3 — if a real JD was pasted, replace the synthetic Job Success
      // Model (built from the six selects above) with one decomposed from
      // the actual text. Best-effort: a failure here shouldn't block entry.
      if (jobDescriptionText.trim()) {
        await api
          .post('/profile/ingest/job-description', {
            jobDescriptionText,
            companyContext: companyContext || undefined,
            sessionId: session.id,
          })
          .catch(() => undefined);
      }
      router.push(`/hyrte/session/${session.id}/mission-brief`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the simulation');
      setLoading(false);
    }
  }

  return (
    <DashboardShell
      area="hyrte"
      title="HYRTE — Living Workplace Simulation"
      requiredRoles={['CANDIDATE']}
      navOverride={[]}
      backHref="/candidate"
      backLabel="Dashboard"
    >
      <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center py-10">
        <p className="mb-6 text-sm text-black/60 dark:text-white/60">
          Set up your simulation. You&apos;ll be dropped into a live workplace as this role — inbox, Slack,
          tasks, calendar, and stakeholders all populate for you.
        </p>

        <div className="card space-y-5">
          <Field label="Role" value={role} onChange={setRole} options={ROLES} />
          <Field label="Experience level" value={experienceLevel} onChange={setExperienceLevel} options={EXPERIENCE_LEVELS} />
          <Field label="Industry" value={industry} onChange={setIndustry} options={INDUSTRIES} />
          <Field label="Company type" value={companyType} onChange={setCompanyType} options={COMPANY_TYPES} />
          <Field label="Difficulty" value={difficulty} onChange={setDifficulty} options={DIFFICULTIES} />
          <Field label="Company culture" value={culture} onChange={setCulture} options={CULTURES} />

          <details className="rounded-lg border border-black/10 p-3 dark:border-white/10">
            <summary className="cursor-pointer text-sm font-medium">
              Have a real job description? Paste it (optional)
            </summary>
            <p className="mb-3 mt-2 text-xs text-black/50 dark:text-white/50">
              Replaces the six selections above as the source for the Job Success Model — decomposed from your
              actual text instead of synthesized.
            </p>
            <textarea
              value={jobDescriptionText}
              onChange={(e) => setJobDescriptionText(e.target.value)}
              rows={6}
              placeholder="Paste the job description…"
              className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15"
            />
            <textarea
              value={companyContext}
              onChange={(e) => setCompanyContext(e.target.value)}
              rows={2}
              placeholder="Company/industry context (optional)…"
              className="mt-2 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15"
            />
          </details>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button className="btn-primary w-full" disabled={loading} onClick={start}>
            {loading ? 'Building your workplace…' : 'Enter the workplace'}
          </button>
        </div>
      </div>
    </DashboardShell>
  );
}

function Field({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <select
        className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o} className="text-black">
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
