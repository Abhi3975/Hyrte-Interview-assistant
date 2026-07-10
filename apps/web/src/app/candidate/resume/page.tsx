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
}

export default function ResumePage() {
  const [profile, setProfile] = useState<Profile>({ skills: [] });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<{ candidateProfile?: Profile }>('/users/me')
      .then((me) => me.candidateProfile && setProfile(me.candidateProfile))
      .catch(() => undefined);
  }, []);

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
    </DashboardShell>
  );
}
