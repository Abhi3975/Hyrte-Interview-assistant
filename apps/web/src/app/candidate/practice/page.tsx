'use client';

import { useState } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';

// Specific tech/topic interviews → each maps to a category + a precise topic
// the AI generates questions for. This is what makes "React JS interview",
// "Node.js interview", "Python interview" etc. real.
const TOPICS: { label: string; category: string; topic: string }[] = [
  { label: 'JavaScript', category: 'FRONTEND', topic: 'JavaScript' },
  { label: 'TypeScript', category: 'FRONTEND', topic: 'TypeScript' },
  { label: 'React.js', category: 'FRONTEND', topic: 'React' },
  { label: 'Next.js', category: 'FRONTEND', topic: 'Next.js' },
  { label: 'Node.js', category: 'BACKEND', topic: 'Node.js' },
  { label: 'Python', category: 'BACKEND', topic: 'Python' },
  { label: 'Java', category: 'BACKEND', topic: 'Java' },
  { label: 'C++', category: 'DSA', topic: 'C++' },
  { label: 'DSA & Algorithms', category: 'DSA', topic: 'Data Structures and Algorithms' },
  { label: 'System Design', category: 'SYSTEM_DESIGN', topic: 'System Design' },
  { label: 'SQL / Database', category: 'SQL', topic: 'SQL' },
  { label: 'DevOps', category: 'DEVOPS', topic: 'DevOps and CI/CD' },
  { label: 'AI / ML', category: 'AI_ML', topic: 'Machine Learning' },
  { label: 'Data Analytics', category: 'DATA_ANALYTICS', topic: 'Data Analytics' },
  { label: 'Finance', category: 'FINANCE', topic: 'Corporate Finance' },
  { label: 'Product Mgmt', category: 'PRODUCT_MANAGEMENT', topic: 'Product Management' },
  { label: 'HR / Behavioral', category: 'HR', topic: 'Behavioral' },
];
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const;

interface Question { id: string; title: string; prompt: string; type: string }
interface Evaluation {
  overallScore: number;
  competencies: Record<string, number>;
  strengths: string[];
  weaknesses: string[];
  summary: string;
  recommendation: string;
}
type Phase = 'setup' | 'interview' | 'evaluating' | 'result';

export default function PracticePage() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [topicIdx, setTopicIdx] = useState(0);
  const [difficulty, setDifficulty] = useState('MEDIUM');
  const selected = TOPICS[topicIdx];
  const category = selected.category;
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [result, setResult] = useState<Evaluation | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function begin() {
    setError(''); setLoading(true);
    try {
      const qs = await api.post<Question[]>('/practice/start', { category, topic: selected.topic, difficulty, count: 5 });
      if (!qs.length) { setError('No questions available for this topic yet. Try another.'); return; }
      setQuestions(qs);
      setAnswers(new Array(qs.length).fill(''));
      setIdx(0);
      setPhase('interview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start');
    } finally { setLoading(false); }
  }

  function setAnswer(v: string) {
    setAnswers((a) => { const n = [...a]; n[idx] = v; return n; });
  }

  async function finish() {
    setPhase('evaluating');
    try {
      const res = await api.post<Evaluation>('/practice/evaluate', {
        category, difficulty,
        answers: questions.map((q, i) => ({ prompt: q.prompt, response: answers[i] })),
      });
      setResult(res);
      setPhase('result');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Evaluation failed');
      setPhase('interview');
    }
  }

  return (
    <DashboardShell area="candidate" title="Mock Interview" requiredRoles={['CANDIDATE']}>
      {phase === 'setup' && (
        <div className="max-w-3xl">
          <p className="mb-4 text-sm text-black/60 dark:text-white/60">
            Pick a topic — the AI runs a real interview on it, asks follow-ups, and gives you
            instant scored feedback. No recruiter, no approval, start anytime.
          </p>
          <label className="mb-2 block text-sm font-medium">Choose your interview</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {TOPICS.map((t, i) => (
              <button
                key={t.label}
                onClick={() => setTopicIdx(i)}
                className={`rounded-lg border px-3 py-3 text-left text-sm transition ${
                  i === topicIdx
                    ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                    : 'border-black/10 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <label className="mb-2 mt-5 block text-sm font-medium">Difficulty</label>
          <div className="flex gap-2">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                onClick={() => setDifficulty(d)}
                className={`rounded-lg border px-4 py-2 text-sm transition ${
                  d === difficulty
                    ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                    : 'border-black/10 dark:border-white/15'
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
          <button onClick={begin} disabled={loading} className="btn-primary mt-6">
            {loading ? 'Preparing your interview…' : `Start ${selected.label} interview`}
          </button>
        </div>
      )}

      {phase === 'interview' && questions[idx] && (
        <div className="max-w-2xl">
          <div className="mb-3 flex items-center justify-between text-sm text-black/50 dark:text-white/50">
            <span>Question {idx + 1} of {questions.length}</span>
            <span>{selected.label} · {difficulty}</span>
          </div>
          <div className="card">
            <h3 className="font-semibold">{questions[idx].title}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm">{questions[idx].prompt}</p>
            <textarea
              value={answers[idx]}
              onChange={(e) => setAnswer(e.target.value)}
              rows={9}
              placeholder={category === 'DSA' ? 'Explain your approach and write your code/pseudocode…' : 'Type your answer…'}
              className="mt-4 w-full rounded-lg border border-black/10 bg-transparent p-3 font-mono text-sm outline-none focus:border-brand-500 dark:border-white/15"
            />
            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
            <div className="mt-4 flex justify-between">
              <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} className="btn-ghost text-sm">← Previous</button>
              {idx < questions.length - 1 ? (
                <button onClick={() => setIdx((i) => i + 1)} className="btn-primary text-sm">Next →</button>
              ) : (
                <button onClick={finish} className="btn-primary text-sm">Finish & get feedback</button>
              )}
            </div>
          </div>
        </div>
      )}

      {phase === 'evaluating' && (
        <div className="card max-w-xl text-sm text-black/60 dark:text-white/60">
          Evaluating your answers with AI… this takes a few seconds.
        </div>
      )}

      {phase === 'result' && result && (
        <div className="max-w-2xl space-y-4">
          <div className="card flex items-center justify-between">
            <div>
              <div className="text-sm text-black/50 dark:text-white/50">Overall score</div>
              <div className="text-3xl font-bold">{result.overallScore}<span className="text-lg text-black/40">/100</span></div>
            </div>
            <span className="rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-sm font-medium text-brand-500">
              {result.recommendation.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="card">
            <h3 className="font-semibold">Competencies</h3>
            <div className="mt-3 space-y-2">
              {Object.entries(result.competencies).map(([k, v]) => (
                <div key={k}>
                  <div className="flex justify-between text-xs"><span className="capitalize">{k.replace(/([A-Z])/g, ' $1')}</span><span>{v}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-black/10 dark:bg-white/10"><div className="h-full rounded-full bg-brand-500" style={{ width: `${v}%` }} /></div>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="card"><h3 className="font-semibold text-emerald-500">Strengths</h3><ul className="mt-2 space-y-1 text-sm text-black/70 dark:text-white/70">{result.strengths.map((s, i) => <li key={i}>+ {s}</li>)}</ul></div>
            <div className="card"><h3 className="font-semibold text-amber-500">Improve</h3><ul className="mt-2 space-y-1 text-sm text-black/70 dark:text-white/70">{result.weaknesses.map((s, i) => <li key={i}>· {s}</li>)}</ul></div>
          </div>
          <div className="card"><h3 className="font-semibold">Summary</h3><p className="mt-2 text-sm text-black/70 dark:text-white/70">{result.summary}</p></div>
          <button onClick={() => { setPhase('setup'); setResult(null); }} className="btn-primary">Practice again</button>
        </div>
      )}
    </DashboardShell>
  );
}
