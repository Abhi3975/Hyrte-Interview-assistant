import Link from 'next/link';
import type { ComponentType, SVGProps } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  BankIcon,
  CheckIcon,
  CodeIcon,
  GaugeIcon,
  MicIcon,
  ShieldIcon,
  VideoIcon,
} from '@/components/icons';

const FEATURES: { Icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; body: string }[] = [
  { Icon: MicIcon, title: 'AI Voice Interviews', body: 'Human-like interviewer with dynamic follow-ups, adaptive difficulty, and multi-language support.' },
  { Icon: VideoIcon, title: 'AI Video & Vision', body: 'Eye-contact, face presence, confidence and communication analysis in real time.' },
  { Icon: CodeIcon, title: 'DSA & Full-Stack', body: 'Blind-75 patterns, live code editor, execution engine, and plagiarism detection.' },
  { Icon: ShieldIcon, title: 'Zero-Trust Proctoring', body: 'Weighted risk scoring across identity, vision, audio, screen & desktop signals — evidence, never accusations.' },
  { Icon: GaugeIcon, title: 'AI Evaluation Engine', body: 'Technical, communication, confidence, problem-solving & leadership scores with a hiring recommendation.' },
  { Icon: BankIcon, title: 'Compliant Question Bank', body: 'License-verified aggregation from permissive open datasets, plus AI generation and your own questions.' },
];

// "Try Interview now" role gallery — each launches the proctored room with the
// role preselected (query index into the room's TOPICS list).
const ROLES: { label: string; blurb: string; topic: number }[] = [
  { label: 'Software Engineer', blurb: 'DSA, problem solving & complexity', topic: 0 },
  { label: 'Frontend (React)', blurb: 'React, JavaScript & UI', topic: 1 },
  { label: 'Backend (Node)', blurb: 'APIs, Node.js & databases', topic: 2 },
  { label: 'System Design', blurb: 'Scalability & architecture', topic: 5 },
  { label: 'Data Analyst (SQL)', blurb: 'SQL, queries & modelling', topic: 6 },
  { label: 'Product Manager', blurb: 'Product sense & metrics', topic: 10 },
];

export default function LandingPage() {
  return (
    <main>
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="text-lg font-bold">
          Interview<span className="text-brand-500">AI</span>
        </div>
        <nav className="flex items-center gap-3">
          <Link href="/login" className="btn-ghost">Log in</Link>
          <Link href="/signup" className="btn-primary">Try AI Interview</Link>
          <ThemeToggle />
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 pb-14 pt-14 text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-500">
          ● Trained on 100,000+ interviews
        </div>
        <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-6xl">
          Never take an <span className="text-brand-500">interview</span> again.
          <br />InterviewAI takes them for you.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-black/60 dark:text-white/60">
          Fully automated, human-like AI interviews — voice, video, live coding and
          enterprise-grade proctoring — ending in a scored, decision-ready report.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/signup" className="btn-primary px-6 py-3">Try AI Interview</Link>
          <Link href="/login" className="btn-ghost px-6 py-3">Book a demo</Link>
        </div>
      </section>

      {/* Role gallery — "Try Interview now" */}
      <section className="mx-auto max-w-6xl px-6 pb-8">
        <div className="mb-2 text-center text-xs font-semibold uppercase tracking-widest text-brand-500">Try Interview</div>
        <h2 className="text-center text-2xl font-bold sm:text-3xl">AI Interview tailored for every role</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r.label} className="card flex flex-col">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-brand-500/20 bg-brand-500/10 text-brand-500">
                <CodeIcon className="h-5 w-5" />
              </div>
              <h3 className="mt-3 font-semibold">{r.label}</h3>
              <p className="mt-1 flex-1 text-sm text-black/60 dark:text-white/60">{r.blurb}</p>
              <Link
                href={`/signup?role=${encodeURIComponent(r.label)}&next=${encodeURIComponent(`/candidate/interview?topic=${r.topic}`)}`}
                className="btn-primary mt-4 justify-center"
              >
                Try Interview now
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-brand-500/20 bg-brand-500/10 text-brand-500">
                <f.Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-black/60 dark:text-white/60">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Personas */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { title: 'For Candidates', points: ['Practice & real interviews', 'Instant AI feedback', 'Progress analytics'] },
            { title: 'For Recruiters', points: ['Create assessments in minutes', 'Compare candidates', 'Live proctoring dashboard'] },
            { title: 'For Enterprises', points: ['Multi-tenant & RBAC', 'Audit logs & compliance', 'Auto-scaling on Kubernetes'] },
          ].map((p) => (
            <div key={p.title} className="card">
              <h3 className="font-semibold">{p.title}</h3>
              <ul className="mt-3 space-y-2 text-sm text-black/60 dark:text-white/60">
                {p.points.map((pt) => (
                  <li key={pt} className="flex items-center gap-2">
                    <CheckIcon className="h-4 w-4 shrink-0 text-brand-500" />
                    {pt}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-sm text-black/40 dark:text-white/40">
        © {new Date().getFullYear()} InterviewAI. Only license-compliant question sources.
      </footer>
    </main>
  );
}
