import Link from 'next/link';
import type { ComponentType, SVGProps } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  AlertIcon,
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
    <main className="relative overflow-hidden">
      {/* Animation system (no external deps) */}
      <style>{`
        @keyframes riseIn { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes glowPulse { 0%,100% { opacity: .5; transform: translate(-50%, -50%) scale(1); } 50% { opacity: .8; transform: translate(-50%, -50%) scale(1.12); } }
        @keyframes hueShift { 0%,100% { filter: hue-rotate(0deg); } 50% { filter: hue-rotate(28deg); } }
        .rise { opacity: 0; animation: riseIn .7s cubic-bezier(.22,.9,.32,1) forwards; }
        .d1{animation-delay:.05s}.d2{animation-delay:.14s}.d3{animation-delay:.24s}.d4{animation-delay:.34s}.d5{animation-delay:.44s}
        .hero-glow { position:absolute; left:50%; top:220px; width:820px; height:520px; border-radius:9999px;
          background: radial-gradient(closest-side, rgba(59,130,246,.28), rgba(109,94,252,.12), transparent 70%);
          filter: blur(20px); animation: glowPulse 7s ease-in-out infinite; pointer-events:none; z-index:0; }
        .lift { transition: transform .25s cubic-bezier(.22,.9,.32,1), box-shadow .25s, border-color .25s; }
        .lift:hover { transform: translateY(-6px); box-shadow: 0 18px 40px -18px rgba(59,130,246,.55); border-color: rgba(59,130,246,.45); }
        .grad-text { background: linear-gradient(90deg,#6d5efc,#3b82f6,#22d3ee,#6d5efc); background-size:300% 100%;
          -webkit-background-clip:text; background-clip:text; color:transparent; animation: hueShift 6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce){ .rise{animation:none;opacity:1} .hero-glow{animation:none} .grad-text{animation:none} }
      `}</style>
      <div className="hero-glow" aria-hidden />

      {/* Nav */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
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
      <section className="relative z-10 mx-auto max-w-4xl px-6 pb-14 pt-14 text-center">
        <div className="rise d1 mb-5 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" /> Trained on 100,000+ interviews
        </div>
        <h1 className="rise d2 text-balance text-4xl font-bold tracking-tight sm:text-6xl">
          Never take an <span className="grad-text">interview</span> again.
          <br />InterviewAI takes them for you.
        </h1>
        <p className="rise d3 mx-auto mt-6 max-w-2xl text-lg text-black/60 dark:text-white/60">
          Fully automated, human-like AI interviews — voice, video, live coding and
          enterprise-grade proctoring — ending in a scored, decision-ready report.
        </p>
        <div className="rise d4 mt-8 flex items-center justify-center gap-3">
          <Link href="/signup" className="btn-primary px-6 py-3 transition-transform hover:scale-105">Try AI Interview</Link>
          <Link href="/login" className="btn-ghost px-6 py-3">Book a demo</Link>
        </div>
      </section>

      {/* Role gallery — "Try Interview now" */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-8">
        <div className="mb-2 text-center text-xs font-semibold uppercase tracking-widest text-brand-500">Try Interview</div>
        <h2 className="text-center text-2xl font-bold sm:text-3xl">AI Interview tailored for every role</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r, i) => (
            <div key={r.label} className={`card lift rise d${(i % 5) + 1} flex flex-col`}>
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

      {/* Product showcase — Koyo-style */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-2xl font-bold sm:text-3xl">Everything you need to run interviews, end-to-end</h2>
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {/* Anti-cheating */}
          <div className="card lift">
            <h3 className="text-lg font-semibold">100% Anti-Cheating</h3>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">Every suspicious signal is flagged live and recorded for review.</p>
            <div className="mt-4 rounded-xl border border-black/5 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[['Eye Shift', 'text-red-500', true], ['AI-Assist Detected', 'text-red-500', true], ['Switched Tabs', 'text-amber-500', true], ['Second Voice', 'text-black/40 dark:text-white/40', false]].map(([label, color, on]) => (
                  <div key={label as string} className={`flex items-center justify-between rounded-lg px-2.5 py-2 ${on ? 'bg-black/5 dark:bg-white/10' : 'bg-black/[0.02] dark:bg-white/[0.04]'}`}>
                    <span className={`inline-flex items-center gap-1.5 ${color as string}`}>{on ? <AlertIcon className="h-3.5 w-3.5" /> : <CheckIcon className="h-3.5 w-3.5" />}{label as string}</span>
                    {on ? <span className="text-xs font-semibold text-red-500">•</span> : null}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-500"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> REC</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-500"><ShieldIcon className="h-3 w-3" /> Proctoring Enabled</span>
              </div>
            </div>
          </div>
          {/* 2-minute summary */}
          <div className="card lift">
            <h3 className="text-lg font-semibold">2-Minute Interview Summary</h3>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">Key signals, scores and a hiring recommendation — decide fast.</p>
            <div className="mt-4 flex items-center gap-4 rounded-xl border border-black/5 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]">
              <svg viewBox="0 0 120 70" className="w-28 shrink-0">
                <path d="M8 60 A52 52 0 0 1 112 60" fill="none" stroke="currentColor" strokeWidth="8" className="text-black/10 dark:text-white/10" strokeLinecap="round" />
                <path d="M8 60 A52 52 0 0 1 96 34" fill="none" stroke="#10b981" strokeWidth="8" strokeLinecap="round" />
                <text x="60" y="52" textAnchor="middle" className="fill-current text-[20px] font-bold">80</text>
              </svg>
              <div className="flex-1 space-y-1.5">
                {[['Communication', 82], ['Problem solving', 78], ['Code quality', 74]].map(([k, v]) => (
                  <div key={k as string}>
                    <div className="flex justify-between text-xs"><span>{k as string}</span><span className="tabular-nums">{v as number}</span></div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-black/10 dark:bg-white/10"><div className="h-full rounded-full bg-brand-500" style={{ width: `${v as number}%` }} /></div>
                  </div>
                ))}
                <span className="mt-1 inline-block rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">HIRE</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card lift">
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
            <div key={p.title} className="card lift">
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
