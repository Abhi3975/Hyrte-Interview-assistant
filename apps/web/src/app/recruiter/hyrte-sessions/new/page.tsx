'use client';

import { useState } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { api, ApiError } from '@/lib/api';
import { INDUSTRY_CATEGORIES, INDUSTRY_VERTICAL_LABELS } from '@/lib/hyrte-industries';

const EXPERIENCE_LEVELS = ['Intern', 'Junior', 'Mid', 'Senior', 'Lead/Manager'];
const COMPANY_TYPES = ['Startup', 'SME', 'Enterprise', 'Consulting', 'Government'];
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'];

interface CapabilityRequirement {
  skill: string;
  importance: string;
  depth?: string;
}

interface DecomposedJd {
  role?: string;
  coreOutcomes?: string[];
  capabilityRequirements?: CapabilityRequirement[];
  industryProbeThemes?: string[];
  suggestedSeed?: {
    experienceLevel?: string;
    industry?: string;
    companyType?: string;
    difficulty?: string;
    culture?: string;
  };
}

interface CreatedRequest {
  id: string;
  code: string;
}

/** Upgrade §1 — the entry point. Nothing generates until a recruiter has decomposed a real JD here. */
export default function NewHyrteSessionPage() {
  const [jobDescriptionText, setJobDescriptionText] = useState('');
  const [companyContext, setCompanyContext] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [decomposed, setDecomposed] = useState<DecomposedJd | null>(null);
  const [created, setCreated] = useState<CreatedRequest | null>(null);

  const [role, setRole] = useState('');
  const [experienceLevel, setExperienceLevel] = useState(EXPERIENCE_LEVELS[2]);
  const [industry, setIndustry] = useState(INDUSTRY_CATEGORIES[0].verticals[0].label);
  const [companyType, setCompanyType] = useState(COMPANY_TYPES[0]);
  const [difficulty, setDifficulty] = useState(DIFFICULTIES[1]);
  const [culture, setCulture] = useState('');

  async function decompose() {
    if (!jobDescriptionText.trim()) return;
    setPreviewing(true);
    setError('');
    try {
      const result = await api.post<DecomposedJd>('/hyrte/simulation-requests/preview', {
        jobDescriptionText,
        companyContext: companyContext || undefined,
      });
      setDecomposed(result);
      setRole(result.role ?? '');
      const seed = result.suggestedSeed ?? {};
      setExperienceLevel(closestMatch(seed.experienceLevel, EXPERIENCE_LEVELS));
      setIndustry(closestMatch(seed.industry, INDUSTRY_VERTICAL_LABELS));
      setCompanyType(closestMatch(seed.companyType, COMPANY_TYPES));
      setDifficulty(closestMatch(seed.difficulty?.toUpperCase(), DIFFICULTIES));
      setCulture(seed.culture ?? '');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not decompose this job description');
    } finally {
      setPreviewing(false);
    }
  }

  async function create() {
    if (!decomposed) return;
    setCreating(true);
    setError('');
    try {
      const result = await api.post<CreatedRequest>('/hyrte/simulation-requests', {
        jobDescriptionText,
        companyContext: companyContext || undefined,
        role,
        coreOutcomes: decomposed.coreOutcomes ?? [],
        capabilityRequirements: decomposed.capabilityRequirements ?? [],
        industryProbeThemes: decomposed.industryProbeThemes ?? [],
        experienceLevel,
        industry,
        companyType,
        difficulty,
        culture: culture || 'Customer-obsessed',
      });
      setCreated(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the simulation link');
    } finally {
      setCreating(false);
    }
  }

  const shareUrl = created ? `${typeof window !== 'undefined' ? window.location.origin : ''}/hyrte/start/${created.code}` : '';

  return (
    <DashboardShell area="recruiter" title="New HYRTE Simulation" requiredRoles={['RECRUITER', 'ORG_ADMIN', 'SUPER_ADMIN']}>
      <div className="mx-auto max-w-2xl space-y-5 py-6">
        <p className="text-sm text-black/60 dark:text-white/60">
          Paste a real job description. Nothing generates until it&apos;s decomposed here — the simulation
          candidates enter is grounded in this text, not a generic role template.
        </p>

        {error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}

        {!created && (
          <div className="card space-y-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Job description</span>
              <textarea
                value={jobDescriptionText}
                onChange={(e) => setJobDescriptionText(e.target.value)}
                rows={8}
                placeholder="Paste the job description…"
                className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Company / industry context (optional)</span>
              <textarea
                value={companyContext}
                onChange={(e) => setCompanyContext(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15"
              />
            </label>
            <button className="btn-primary" disabled={previewing || !jobDescriptionText.trim()} onClick={decompose}>
              {previewing ? 'Decomposing…' : decomposed ? 'Re-decompose' : 'Decompose job description'}
            </button>
          </div>
        )}

        {decomposed && !created && (
          <div className="card space-y-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
                Core outcomes this role must accomplish
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {(decomposed.coreOutcomes ?? []).map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
                Capability requirements
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(decomposed.capabilityRequirements ?? []).map((c, i) => (
                  <span key={i} className="rounded-full border border-black/10 px-3 py-1 text-xs dark:border-white/15">
                    {c.skill} <span className="text-black/40 dark:text-white/40">· {c.importance}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 block">
                <span className="mb-1 block text-sm font-medium">Role</span>
                <input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15"
                />
              </label>
              <Field label="Experience level" value={experienceLevel} onChange={setExperienceLevel} options={EXPERIENCE_LEVELS} />
              <GroupedField label="Industry" value={industry} onChange={setIndustry} />
              <Field label="Company type" value={companyType} onChange={setCompanyType} options={COMPANY_TYPES} />
              <Field label="Difficulty" value={difficulty} onChange={setDifficulty} options={DIFFICULTIES} />
              <label className="col-span-2 block">
                <span className="mb-1 block text-sm font-medium">Company culture</span>
                <input
                  value={culture}
                  onChange={(e) => setCulture(e.target.value)}
                  placeholder="e.g. Customer-obsessed"
                  className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15"
                />
              </label>
            </div>
            <p className="text-xs text-black/50 dark:text-white/50">
              These are pre-filled from the job description above — review and edit before creating the link.
            </p>
            <button className="btn-primary w-full" disabled={creating || !role.trim()} onClick={create}>
              {creating ? 'Creating…' : 'Create simulation link'}
            </button>
          </div>
        )}

        {created && (
          <div className="card space-y-3">
            <div className="text-sm font-semibold">Simulation link ready</div>
            <p className="text-sm text-black/60 dark:text-white/60">
              Share this with candidates. Anyone with the link can preview the role before signing in, then
              launch their own simulation grounded in the job description above.
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-black/5 px-3 py-2 text-sm dark:border-white/15 dark:bg-white/5">
              <code className="flex-1 truncate">{shareUrl}</code>
              <button
                className="btn-ghost text-xs"
                onClick={() => navigator.clipboard.writeText(shareUrl)}
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function closestMatch(value: string | undefined, options: string[]): string {
  if (!value) return options[0];
  const found = options.find((o) => o.toLowerCase() === value.toLowerCase());
  return found ?? options[0];
}

/** Recruiter doc §2 — real categories with sub-verticals, rendered as native <optgroup>s rather than a flat 5-item list. */
function GroupedField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <select
        className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {INDUSTRY_CATEGORIES.map((category) => (
          <optgroup key={category.id} label={category.label} className="text-black">
            {category.verticals.map((v) => (
              <option key={v.id} value={v.label} className="text-black">
                {v.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
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
