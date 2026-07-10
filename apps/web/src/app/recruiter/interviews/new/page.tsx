'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';

const CATEGORIES = ['DSA', 'FRONTEND', 'BACKEND', 'FULLSTACK', 'SQL', 'DATABASE', 'DEVOPS', 'AI_ML', 'DATA_ANALYTICS', 'PRODUCT_MANAGEMENT', 'MBA', 'HR', 'FINANCE', 'SYSTEM_DESIGN'];
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'];
const MODES = ['VOICE', 'VIDEO', 'CODING', 'TEXT', 'MIXED'];

export default function NewAssessmentPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: '',
    jobRole: '',
    category: 'DSA',
    difficulty: 'MEDIUM',
    mode: 'MIXED',
    durationMins: 45,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/interviews', form);
      router.push('/recruiter');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setLoading(false);
    }
  }

  return (
    <DashboardShell area="recruiter" title="New Assessment" requiredRoles={['RECRUITER', 'ORG_ADMIN']}>
      <form onSubmit={submit} className="card max-w-2xl space-y-4">
        <Field label="Title">
          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Backend Engineer — Round 1" className={inputCls} />
        </Field>
        <Field label="Job role">
          <input required value={form.jobRole} onChange={(e) => setForm({ ...form, jobRole: e.target.value })}
            placeholder="Senior Backend Engineer" className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Difficulty">
            <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })} className={inputCls}>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Mode">
            <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className={inputCls}>
              {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Duration (mins)">
            <input type="number" min={5} value={form.durationMins}
              onChange={(e) => setForm({ ...form, durationMins: Number(e.target.value) })} className={inputCls} />
          </Field>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button className="btn-primary" disabled={loading}>{loading ? 'Creating…' : 'Create assessment'}</button>
      </form>
    </DashboardShell>
  );
}

const inputCls =
  'mt-1 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
