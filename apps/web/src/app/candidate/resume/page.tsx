'use client';

import { useEffect, useState } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';
import { CheckIcon } from '@/components/icons';

const SKILL_OPTIONS = [
  'React', 'Next.js', 'TypeScript', 'Node.js', 'Python', 'Java', 'Go',
  'SQL', 'PostgreSQL', 'MongoDB', 'System Design', 'DevOps', 'AWS',
  'Data Analysis', 'Machine Learning', 'Product Management',
];

interface Profile {
  headline?: string;
  resumeUrl?: string;
  resumeText?: string;
  skills?: string[];
  location?: string;
  linkedinSummary?: string;
  githubUsername?: string;
}

interface EvidenceObject {
  id: string;
  source: string;
  type: string;
  rawText: string;
  needsInvestigation: boolean;
  probeCandidates: string[];
}

interface IntelligenceCard {
  evidenceDensity: number;
  leadershipExposure: string;
  technicalDepthConfidence: string;
  primaryExposureAreas: string[];
}

export default function ResumePage() {
  const [profile, setProfile] = useState<Profile>({ skills: [] });
  const [saved, setSaved] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceObject[]>([]);
  const [card, setCard] = useState<IntelligenceCard | null>(null);
  const [ingesting, setIngesting] = useState<'resume' | 'linkedin' | 'github' | null>(null);

  useEffect(() => {
    api.get<{ candidateProfile?: Profile }>('/users/me')
      .then((me) => me.candidateProfile && setProfile(me.candidateProfile))
      .catch(() => undefined);
    refreshEvidence();
  }, []);

  function refreshEvidence() {
    api
      .get<{ evidence: EvidenceObject[]; intelligenceCard: IntelligenceCard | null }>('/profile/ingest')
      .then((r) => {
        setEvidence(r.evidence);
        setCard(r.intelligenceCard);
      })
      .catch(() => undefined);
  }

  async function ingest(kind: 'resume' | 'linkedin' | 'github') {
    setIngesting(kind);
    try {
      if (kind === 'resume') await api.post('/profile/ingest/resume', { resumeText: profile.resumeText ?? '' });
      else if (kind === 'linkedin') await api.post('/profile/ingest/linkedin', { linkedinSummary: profile.linkedinSummary ?? '' });
      else await api.post('/profile/ingest/github', { username: profile.githubUsername ?? '' });
      refreshEvidence();
    } finally {
      setIngesting(null);
    }
  }

  function toggleSkill(skill: string) {
    setProfile((p) => {
      const set = new Set(p.skills ?? []);
      set.has(skill) ? set.delete(skill) : set.add(skill);
      return { ...p, skills: [...set] };
    });
  }

  async function save() {
    await api.patch('/users/me/profile', profile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <DashboardShell area="candidate" title="Resume & Skills" requiredRoles={['CANDIDATE']}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card">
          <h3 className="font-semibold">Your resume</h3>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Paste your resume text (or upload a file). The AI interviewer reads this to ask
            personalized, project-specific questions.
          </p>
          <label className="mt-4 block text-sm font-medium">Headline</label>
          <input
            value={profile.headline ?? ''}
            onChange={(e) => setProfile({ ...profile, headline: e.target.value })}
            placeholder="Full-stack engineer, 3 yrs"
            className="mt-1 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15"
          />
          <label className="mt-4 block text-sm font-medium">Resume text</label>
          <textarea
            value={profile.resumeText ?? ''}
            onChange={(e) => setProfile({ ...profile, resumeText: e.target.value })}
            rows={10}
            placeholder="Experience, projects, education…"
            className="mt-1 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15"
          />
          <button
            onClick={() => ingest('resume')}
            disabled={!profile.resumeText?.trim() || ingesting === 'resume'}
            className="mt-3 rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-medium text-brand-500 disabled:opacity-40"
          >
            {ingesting === 'resume' ? 'Analyzing…' : 'Analyze into Evidence Graph'}
          </button>
        </div>

        <div className="card">
          <h3 className="font-semibold">Skills</h3>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">Select what you want to be interviewed on.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {SKILL_OPTIONS.map((s) => {
              const active = profile.skills?.includes(s);
              return (
                <button
                  key={s}
                  onClick={() => toggleSkill(s)}
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    active ? 'border-brand-500 bg-brand-500/10 text-brand-500' : 'border-black/10 dark:border-white/15'
                  }`}
                >
                  {s}
                </button>
              );
            })}
          </div>

          <button onClick={save} className="btn-primary mt-6 inline-flex items-center gap-1.5">
            {saved ? <><CheckIcon width={16} height={16} /> Saved</> : 'Save profile'}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="card">
          <h3 className="font-semibold">LinkedIn</h3>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            No live LinkedIn integration — paste your profile summary (headline, experience, achievements) and
            it&apos;s analyzed the same way a resume is.
          </p>
          <textarea
            value={profile.linkedinSummary ?? ''}
            onChange={(e) => setProfile({ ...profile, linkedinSummary: e.target.value })}
            rows={6}
            placeholder="Paste your LinkedIn About / Experience sections…"
            className="mt-3 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15"
          />
          <button
            onClick={() => ingest('linkedin')}
            disabled={!profile.linkedinSummary?.trim() || ingesting === 'linkedin'}
            className="mt-3 rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-medium text-brand-500 disabled:opacity-40"
          >
            {ingesting === 'linkedin' ? 'Analyzing…' : 'Analyze into Evidence Graph'}
          </button>
        </div>

        <div className="card">
          <h3 className="font-semibold">GitHub</h3>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Real public-API ingestion — pulls your public repos and activity directly, no paste needed.
          </p>
          <input
            value={profile.githubUsername ?? ''}
            onChange={(e) => setProfile({ ...profile, githubUsername: e.target.value })}
            placeholder="GitHub username"
            className="mt-3 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15"
          />
          <button
            onClick={() => ingest('github')}
            disabled={!profile.githubUsername?.trim() || ingesting === 'github'}
            className="mt-3 rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-medium text-brand-500 disabled:opacity-40"
          >
            {ingesting === 'github' ? 'Analyzing…' : 'Analyze into Evidence Graph'}
          </button>
        </div>
      </div>

      <div className="card mt-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Candidate Evidence Graph</h3>
          {card && (
            <span className="text-xs text-black/50 dark:text-white/50">
              {card.evidenceDensity} evidence objects · leadership: {card.leadershipExposure} · technical depth: {card.technicalDepthConfidence}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Every claim below feeds the Decision Council&apos;s evidence brief — the AI interviewer can cross-examine any
          of these the same way it cross-examines simulation behavior.
        </p>
        <div className="mt-4 space-y-2">
          {evidence.length === 0 && <p className="text-sm text-black/50 dark:text-white/50">Nothing ingested yet.</p>}
          {evidence.map((e) => (
            <div key={e.id} className="rounded-lg border border-black/5 p-3 text-sm dark:border-white/10">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-black/60 dark:bg-white/10 dark:text-white/60">
                  {e.source}
                </span>
                {e.needsInvestigation && (
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600">
                    needs investigation
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-black/80 dark:text-white/80">{e.rawText}</p>
              {e.probeCandidates.length > 0 && (
                <ul className="mt-1.5 list-disc pl-4 text-xs text-black/50 dark:text-white/50">
                  {e.probeCandidates.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
