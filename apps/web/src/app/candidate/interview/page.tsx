'use client';

/**
 * Unified proctored AI interview room.
 *
 * One immersive screen that assembles the pieces that already exist as
 * separate pages into a single live experience:
 *   - AI voice interviewer  → speaks each question (SpeechSynthesis) and can
 *     listen to spoken answers (SpeechRecognition), greeting via /voice/intro.
 *   - Question + scratchpad → AI-generated questions from /practice/start, a
 *     multi-language code/scratchpad editor for the candidate's answer.
 *   - Webcam + proctoring   → live getUserMedia tile plus real client-side
 *     integrity signals (tab switches, paste/AI-assist, face/gaze via the
 *     FaceDetector API when available, background "second voice" via WebAudio).
 *   - Timer + summary       → a countdown, then a scored 2-minute summary from
 *     /practice/evaluate with a competency breakdown and an integrity report.
 *
 * Everything runs against endpoints already verified live, so it works on the
 * deployed AWS stack without new backend wiring.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  MicIcon,
  SpeakerIcon,
  ShieldIcon,
  AlertIcon,
  CheckIcon,
  XIcon,
  CodeIcon,
} from '@/components/icons';

// Role/topic catalogue — each maps to a backend Category + a precise topic the
// AI generates questions for (mirrors the mock-interview picker).
const TOPICS: { label: string; category: string; topic: string; blurb: string }[] = [
  { label: 'Software Engineer', category: 'DSA', topic: 'Data Structures and Algorithms', blurb: 'DSA, problem solving & complexity' },
  { label: 'Frontend (React)', category: 'FRONTEND', topic: 'React', blurb: 'React, JS, browser & UI' },
  { label: 'Backend (Node)', category: 'BACKEND', topic: 'Node.js', blurb: 'APIs, Node.js, databases' },
  { label: 'Python', category: 'BACKEND', topic: 'Python', blurb: 'Python, OOP & scripting' },
  { label: 'Java', category: 'BACKEND', topic: 'Java', blurb: 'Java, JVM & OOP' },
  { label: 'System Design', category: 'SYSTEM_DESIGN', topic: 'System Design', blurb: 'Scalability & architecture' },
  { label: 'SQL / Data Analyst', category: 'SQL', topic: 'SQL', blurb: 'SQL, queries & modelling' },
  { label: 'DevOps', category: 'DEVOPS', topic: 'DevOps and CI/CD', blurb: 'CI/CD, containers & cloud' },
  { label: 'AI / ML', category: 'AI_ML', topic: 'Machine Learning', blurb: 'ML, models & maths' },
  { label: 'Data Analytics', category: 'DATA_ANALYTICS', topic: 'Data Analytics', blurb: 'Analysis & insight' },
  { label: 'Product Manager', category: 'PRODUCT_MANAGEMENT', topic: 'Product Management', blurb: 'Product sense & metrics' },
  { label: 'HR / Behavioral', category: 'HR', topic: 'Behavioral', blurb: 'Behavioural & culture fit' },
];
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const;
const LANGUAGES = ['plaintext', 'javascript', 'typescript', 'python', 'java', 'cpp', 'sql', 'go'];
// Runnable languages for the compiler round (sandbox-backed).
const CODE_LANGUAGES = ['python', 'javascript', 'java', 'cpp', 'go', 'sql'];
// Categories that get a real coding challenge with a compiler.
const CODE_CATEGORIES = new Set(['DSA', 'BACKEND', 'FRONTEND', 'AI_ML', 'SQL', 'DATA_ANALYTICS']);
// Categories whose coding round is SQL (runs against a MySQL sandbox).
const SQL_CATEGORIES = new Set(['SQL']);
const QUESTION_COUNTS = [3, 5, 8, 10];

interface CodingTest { input: string; output: string; hidden: boolean }
interface CodingProblem {
  title: string; statement: string; inputFormat: string; outputFormat: string;
  starter: Record<string, string>; tests: CodingTest[];
}
interface CaseResult { ordinal: number; passed: boolean; hidden: boolean; status: string; stderr?: string | null; expected?: string; actual?: string }
interface RunResult { passed: number; total: number; results: CaseResult[] }

interface Question { id: string; title: string; prompt: string; type: string }
interface PerQuestion { score: number; max: number; notes: string }
interface Evaluation {
  overallScore: number;
  competencies: Record<string, number>;
  strengths: string[];
  weaknesses: string[];
  summary: string;
  recommendation: string;
  perQuestion?: PerQuestion[];
}
type Phase = 'setup' | 'lobby' | 'live' | 'evaluating' | 'result';

// The live integrity signals we surface.
interface Flags {
  tabSwitch: number;   // left the tab / window   → "Switched Tabs"
  eyeShift: number;    // face absent / looking away → "Eye Shift"
  multiFace: number;   // more than one face      → "Multiple Faces"
  aiAssist: number;    // paste into editor       → "AI-Assist Detected"
  secondVoice: number; // background speech        → "Second Voice"
}
const ZERO_FLAGS: Flags = { tabSwitch: 0, eyeShift: 0, multiFace: 0, aiAssist: 0, secondVoice: 0 };

function useHydratedAuth() {
  const { user } = useAuthStore();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAuthStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);
  return { user, hydrated };
}

function InterviewRoomInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, hydrated } = useHydratedAuth();

  const topicParam = Number(params.get('topic'));
  const hasTopicParam = Number.isInteger(topicParam) && topicParam >= 0 && topicParam < TOPICS.length;

  const [phase, setPhase] = useState<Phase>(hasTopicParam ? 'lobby' : 'setup');
  const [topicIdx, setTopicIdx] = useState(hasTopicParam ? topicParam : 0);
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>('MEDIUM');
  const [durationMin, setDurationMin] = useState(20);
  const [numQuestions, setNumQuestions] = useState(5);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [answer, setAnswer] = useState('');
  const [language, setLanguage] = useState('plaintext');
  const [transcript, setTranscript] = useState<{ role: 'ai' | 'you'; text: string }[]>([]);
  const [voiceState, setVoiceState] = useState<'idle' | 'speaking' | 'listening'>('idle');
  const [micOn, setMicOn] = useState(true);
  const [muted, setMuted] = useState(false);
  const [flags, setFlags] = useState<Flags>(ZERO_FLAGS);
  const [remaining, setRemaining] = useState(durationMin * 60);
  const [result, setResult] = useState<Evaluation | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Coding round (compiler)
  const [tab, setTab] = useState<'qa' | 'code'>('qa');
  const [coding, setCoding] = useState<CodingProblem | null>(null);
  const [codeLang, setCodeLang] = useState('python');
  const [codeSrc, setCodeSrc] = useState('');
  const [codeResult, setCodeResult] = useState<RunResult | null>(null);
  const [codeRunning, setCodeRunning] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);

  const topic = TOPICS[topicIdx];

  useEffect(() => {
    if (hydrated && !user) {
      const nextPath = `/candidate/interview${hasTopicParam ? `?topic=${topicParam}` : ''}`;
      router.replace(`/signup?next=${encodeURIComponent(nextPath)}`);
    }
  }, [hydrated, user, router, hasTopicParam, topicParam]);

  // ── media + proctoring teardown ──
  const teardown = useCallback(() => {
    try { recognitionRef.current?.stop?.(); } catch {}
    try { window.speechSynthesis?.cancel(); } catch {}
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    audioCtxRef.current?.close?.().catch(() => {});
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => () => teardown(), [teardown]);

  // ── speech synthesis (interviewer voice) ──
  const speak = useCallback((text: string) => {
    setTranscript((t) => [...t, { role: 'ai', text }]);
    if (muted || typeof window === 'undefined' || !window.speechSynthesis) return;
    setVoiceState('speaking');
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.onend = () => setVoiceState('listening');
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }, [muted]);

  // ── speech recognition (spoken answers → editor) ──
  const startListening = useCallback(() => {
    const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Ctor || !micOn) return;
    try { recognitionRef.current?.stop?.(); } catch {}
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    let finalChunk = '';
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalChunk += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      setAnswer((prev) => {
        // Keep typed content, append recognised speech after a marker.
        const base = prev.split('\n// [voice] ')[0];
        return `${base}\n// [voice] ${(finalChunk + interim).trim()}`;
      });
    };
    rec.onerror = () => {};
    recognitionRef.current = rec;
    try { rec.start(); } catch {}
  }, [micOn]);

  useEffect(() => {
    if (phase !== 'live') return;
    if (voiceState === 'listening' && micOn) startListening();
    if (voiceState !== 'listening') { try { recognitionRef.current?.stop?.(); } catch {} }
  }, [voiceState, phase, micOn, startListening]);

  // ── countdown timer ──
  useEffect(() => {
    if (phase !== 'live') return;
    const iv = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { clearInterval(iv); endInterview(); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── proctoring: tab/window focus ──
  useEffect(() => {
    if (phase !== 'live') return;
    const onHidden = () => { if (document.hidden) bumpFlag('tabSwitch', 'You switched tabs — stay on the interview.'); };
    const onBlur = () => bumpFlag('tabSwitch', 'The interview window lost focus.');
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── proctoring: face / gaze via FaceDetector (Chrome), degrades gracefully ──
  useEffect(() => {
    if (phase !== 'live') return;
    const FD = (window as any).FaceDetector;
    if (!FD || !videoRef.current) return;
    const detector = new FD({ fastMode: true, maxDetectedFaces: 3 });
    let stop = false;
    const loop = async () => {
      if (stop || !videoRef.current) return;
      try {
        const faces = await detector.detect(videoRef.current);
        if (faces.length === 0) bumpFlag('eyeShift', 'Face not detected — look at the screen.', 4000);
        else if (faces.length > 1) bumpFlag('multiFace', 'More than one face detected.', 4000);
        else {
          // gaze proxy: face box drifting toward an edge = looking away
          const box = faces[0].boundingBox;
          const cx = box.x + box.width / 2;
          const w = videoRef.current.videoWidth || 640;
          if (cx < w * 0.28 || cx > w * 0.72) bumpFlag('eyeShift', 'Looking away from the screen.', 4000);
        }
      } catch {}
      rafRef.current = requestAnimationFrame(() => setTimeout(loop, 1200) as unknown as number);
    };
    loop();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const flagCooldown = useRef<Record<string, number>>({});
  function bumpFlag(key: keyof Flags, note: string, cooldownMs = 1500) {
    const now = Date.now();
    if (now - (flagCooldown.current[key] ?? 0) < cooldownMs) return;
    flagCooldown.current[key] = now;
    setFlags((f) => ({ ...f, [key]: f[key] + 1 }));
  }

  // ── start: permissions + questions + greeting ──
  async function start() {
    setError(''); setLoading(true);
    setFlags(ZERO_FLAGS); setTranscript([]); setAnswers([]); setAnswer(''); setIdx(0);
    endedRef.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          window.isSecureContext
            ? 'Camera/microphone are not available in this browser.'
            : 'Camera & mic need a secure (HTTPS) connection. Open this site over https:// and allow permissions.',
        );
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      // wire audio meter for "second voice" heuristic
      try {
        const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
        const ctx: AudioContext = new Ctx();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        let loudFrames = 0;
        const meter = () => {
          if (endedRef.current) return;
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / buf.length);
          // Loud mic input while the interviewer is speaking ⇒ another voice.
          if (voiceStateRef.current === 'speaking' && rms > 0.14) {
            loudFrames++;
            if (loudFrames > 25) { bumpFlag('secondVoice', 'Another voice detected in the room.', 6000); loudFrames = 0; }
          } else loudFrames = Math.max(0, loudFrames - 1);
          requestAnimationFrame(meter);
        };
        meter();
      } catch {}

      const qs = await api.post<Question[]>('/practice/start', {
        category: topic.category, topic: topic.topic, difficulty, count: numQuestions,
      });
      if (!qs.length) { setError('No questions generated for this topic. Try another.'); setPhase('setup'); teardown(); return; }
      setQuestions(qs);
      setRemaining(durationMin * 60);
      // Open a recorded, proctored session so flags + score persist to the DB.
      try {
        const s = await api.post<{ sessionId: string }>('/practice/session', {
          category: topic.category, difficulty, topic: topic.topic, jobRole: topic.label,
        });
        sessionIdRef.current = s.sessionId;
      } catch { sessionIdRef.current = null; }
      // Generate a real coding challenge (with a compiler) for coding roles.
      if (CODE_CATEGORIES.has(topic.category)) {
        const kind = SQL_CATEGORIES.has(topic.category) ? 'sql' : 'code';
        try {
          const prob = await api.post<CodingProblem>('/practice/coding/generate', {
            topic: topic.topic, difficulty, kind,
          });
          if (prob?.tests?.length) {
            setCoding(prob);
            const langs = Object.keys(prob.starter ?? {});
            const lang = prob.starter?.python ? 'python' : langs[0] ?? 'python';
            setCodeLang(lang);
            setCodeSrc(prob.starter?.[lang] ?? '');
          }
        } catch { /* coding round optional */ }
      }
      setPhase('live');

      // greeting via the voice engine, then the first question
      let greeting = `Hello, welcome to your ${topic.label} interview. I'll ask you a few questions — take your time and think out loud.`;
      try {
        const intro = await api.post<{ text: string }>('/voice/intro', {
          jobRole: topic.label, category: topic.category, language: 'English',
        });
        if (intro?.text) greeting = intro.text;
      } catch {}
      speak(greeting);
      setTimeout(() => speak(`Question 1. ${qs[0].prompt}`), 300);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not access camera/microphone. Please allow permissions and retry.');
      setPhase('lobby');
      teardown();
    } finally {
      setLoading(false);
    }
  }

  // keep a ref of voiceState for the audio meter closure
  const voiceStateRef = useRef(voiceState);
  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);

  // attach the stream once the video element mounts in the live phase
  useEffect(() => {
    if (phase === 'live' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [phase]);

  function submitAnswer() {
    const cleaned = answer.trim();
    setTranscript((t) => [...t, { role: 'you', text: cleaned || '(no answer)' }]);
    const nextAnswers = [...answers, cleaned];
    setAnswers(nextAnswers);
    setAnswer('');
    if (idx + 1 < questions.length) {
      const n = idx + 1;
      setIdx(n);
      setTimeout(() => speak(`Question ${n + 1}. ${questions[n].prompt}`), 250);
    } else {
      finalize(nextAnswers);
    }
  }

  async function runCode() {
    if (!coding) return;
    setCodeRunning(true); setCodeResult(null);
    try {
      const res = await api.post<RunResult>('/practice/coding/run', {
        language: codeLang, code: codeSrc, tests: coding.tests,
      });
      setCodeResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code run failed');
    } finally {
      setCodeRunning(false);
    }
  }

  function endInterview() {
    if (endedRef.current) return;
    const pending = answer.trim() ? [...answers, answer.trim()] : answers;
    finalize(pending);
  }

  async function finalize(finalAnswers: string[]) {
    if (endedRef.current) return;
    endedRef.current = true;
    setPhase('evaluating');
    teardown();
    try {
      const payload = questions.slice(0, finalAnswers.length).map((q, i) => ({
        prompt: q.prompt, response: finalAnswers[i] || '(no answer)',
      }));
      // Fold the coding challenge into the scored transcript, if attempted.
      if (coding && codeSrc.trim()) {
        const passLine = codeResult ? `[${codeResult.passed}/${codeResult.total} tests passed]` : '[not run]';
        payload.push({
          prompt: `Coding challenge — ${coding.title}: ${coding.statement}`,
          response: `Language: ${codeLang}\n${passLine}\n\n${codeSrc}`,
        });
      }
      // Prefer the recorded-session path so flags + score persist to the DB and
      // are reviewable later; fall back to stateless evaluate if no session.
      const evalRes = sessionIdRef.current
        ? await api.post<Evaluation>(`/practice/session/${sessionIdRef.current}/complete`, {
            category: topic.category, difficulty, jobRole: topic.label,
            answers: payload, flags, integrity,
          })
        : await api.post<Evaluation>('/practice/evaluate', {
            category: topic.category, difficulty, jobRole: topic.label, answers: payload,
          });
      setResult(evalRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evaluation failed.');
    } finally {
      setPhase('result');
    }
  }

  const integrity = useMemo(() => {
    const penalty = flags.tabSwitch * 6 + flags.eyeShift * 3 + flags.multiFace * 12 + flags.aiAssist * 10 + flags.secondVoice * 8;
    return Math.max(0, 100 - penalty);
  }, [flags]);

  if (!hydrated || !user) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-black/50 dark:text-white/50">Loading…</div>;
  }

  // ─────────────────────────────── SETUP ───────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Start an AI Interview</h1>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">Pick a role, and the AI interviewer will run a live, proctored session — anytime.</p>
          </div>
          <ThemeToggle />
        </div>

        {error && <p className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOPICS.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setTopicIdx(i)}
              className={`card text-left transition ${i === topicIdx ? 'ring-2 ring-brand-500' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'}`}
            >
              <div className="flex items-center gap-2 font-semibold"><CodeIcon width={18} height={18} className="text-brand-500" />{t.label}</div>
              <p className="mt-1 text-xs text-black/55 dark:text-white/55">{t.blurb}</p>
            </button>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-6">
          <div>
            <label className="block text-xs font-medium text-black/60 dark:text-white/60">Difficulty</label>
            <div className="mt-1 flex gap-1">
              {DIFFICULTIES.map((d) => (
                <button key={d} onClick={() => setDifficulty(d)}
                  className={`rounded-lg px-3 py-1.5 text-sm ${d === difficulty ? 'bg-brand-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>
                  {d[0] + d.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-black/60 dark:text-white/60">Duration</label>
            <div className="mt-1 flex gap-1">
              {[10, 20, 30].map((m) => (
                <button key={m} onClick={() => { setDurationMin(m); setRemaining(m * 60); }}
                  className={`rounded-lg px-3 py-1.5 text-sm ${m === durationMin ? 'bg-brand-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>
                  {m} min
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-black/60 dark:text-white/60">Questions</label>
            <div className="mt-1 flex gap-1">
              {QUESTION_COUNTS.map((c) => (
                <button key={c} onClick={() => setNumQuestions(c)}
                  className={`rounded-lg px-3 py-1.5 text-sm ${c === numQuestions ? 'bg-brand-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button onClick={() => setPhase('lobby')} className="btn-primary">
            Continue to {topic.label} interview
          </button>
          <span className="inline-flex items-center gap-1.5 text-xs text-black/50 dark:text-white/50">
            <ShieldIcon width={14} height={14} /> Camera, mic & screen focus are monitored for integrity.
          </span>
        </div>
      </div>
    );
  }

  // ─────────────────────────────── LOBBY ───────────────────────────────
  if (phase === 'lobby') {
    return (
      <div className="min-h-screen bg-neutral-950 px-4 py-8 text-white">
        <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
          <div className="rounded-2xl bg-white/5 p-6">
            <div className="text-lg font-bold">Interview<span className="text-brand-500">AI</span></div>
            <div className="mt-1 text-sm text-white/60">{topic.label} · {difficulty[0] + difficulty.slice(1).toLowerCase()} · Demo Interview</div>

            <div className="mt-6 text-xs font-semibold uppercase tracking-wide text-white/40">Interview Team</div>
            <div className="mt-2 space-y-2">
              <div className="rounded-xl bg-white/5 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500/20 font-semibold text-brand-300"><ShieldIcon width={18} height={18} /></div>
                  <div><div className="font-semibold">Proctor</div><div className="text-xs text-white/60">InterviewAI Integrity</div></div>
                </div>
                <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-amber-400">
                  <ShieldIcon width={12} height={12} /> Reviews your complete interview recording
                </div>
              </div>
              <div className="rounded-xl bg-white/5 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300"><MicIcon width={18} height={18} /></div>
                  <div><div className="font-semibold">AI Interviewer</div><div className="text-xs text-white/60">InterviewAI</div></div>
                </div>
              </div>
            </div>

            <div className="mt-6 text-xs font-semibold uppercase tracking-wide text-white/40">Interview Details</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/5 p-3"><div className="text-[10px] uppercase tracking-wide text-white/40">Time</div><div className="mt-0.5 font-semibold">{durationMin} mins</div></div>
              <div className="rounded-xl bg-white/5 p-3"><div className="text-[10px] uppercase tracking-wide text-white/40">Questions</div><div className="mt-0.5 font-semibold">{numQuestions}{CODE_CATEGORIES.has(topic.category) ? ' + coding' : ''}</div></div>
            </div>
          </div>

          <div className="flex flex-col justify-center rounded-2xl bg-white/5 p-6">
            <h1 className="text-2xl font-bold">Ready to start?</h1>
            <p className="mt-2 text-sm text-white/60">
              The AI interviewer will greet you and ask {numQuestions} adaptive questions{CODE_CATEGORIES.has(topic.category) ? ', plus a live coding challenge you compile and run' : ''}. Your camera, microphone
              and screen focus are monitored for integrity. Speak your answers or type them in the editor.
            </p>
            {error && <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}
            <button onClick={start} disabled={loading} className="btn-primary mt-5 justify-center">
              {loading ? 'Requesting camera & mic…' : 'Start interview'}
            </button>
            <button onClick={() => setPhase('setup')} className="mt-2 text-center text-xs text-white/50">← Change role or difficulty</button>
            <div className="mt-4 flex items-center gap-1.5 text-xs text-white/40">
              <ShieldIcon width={12} height={12} /> This interview is conducted by an AI. Final decisions are made by a human.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────── EVALUATING ───────────────────────────────
  if (phase === 'evaluating') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        <p className="text-sm text-black/60 dark:text-white/60">Scoring your interview & building your report…</p>
      </div>
    );
  }

  // ─────────────────────────────── RESULT ───────────────────────────────
  if (phase === 'result') {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Interview Summary</h1>
          <button onClick={() => setPhase('setup')} className="btn-ghost text-sm">New interview</button>
        </div>
        {error && <p className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
        {result && (
          <div className="grid gap-5 md:grid-cols-[1fr_320px]">
            <div className="card">
              <div className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">2-minute summary</div>
              <p className="mt-2 text-sm leading-relaxed">{result.summary}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-emerald-600">Strengths</div>
                  <ul className="mt-1 space-y-1 text-sm">
                    {result.strengths.map((s) => (
                      <li key={s} className="flex gap-1.5"><CheckIcon width={14} height={14} className="mt-0.5 shrink-0 text-emerald-500" />{s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-semibold text-amber-600">Areas to improve</div>
                  <ul className="mt-1 space-y-1 text-sm">
                    {result.weaknesses.map((w) => (
                      <li key={w} className="flex gap-1.5"><AlertIcon width={14} height={14} className="mt-0.5 shrink-0 text-amber-500" />{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="mt-5">
                <div className="text-xs font-semibold text-black/50 dark:text-white/50">Competencies</div>
                <div className="mt-2 space-y-2">
                  {Object.entries(result.competencies).map(([k, v]) => (
                    <div key={k}>
                      <div className="flex justify-between text-xs capitalize"><span>{k.replace(/([A-Z])/g, ' $1')}</span><span className="tabular-nums">{v}</span></div>
                      <div className="mt-0.5 h-1.5 rounded-full bg-black/10 dark:bg-white/10">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, v)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {result.perQuestion && result.perQuestion.length > 0 && (
                <div className="mt-5">
                  <div className="text-xs font-semibold text-black/50 dark:text-white/50">Per-question breakdown</div>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-black/50 dark:text-white/50">
                          <th className="py-1 pr-2 font-medium">Q</th>
                          <th className="py-1 pr-2 font-medium">Score</th>
                          <th className="py-1 font-medium">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.perQuestion.map((p, i) => (
                          <tr key={i} className="border-t border-black/5 align-top dark:border-white/10">
                            <td className="py-1.5 pr-2 font-medium">Q{i + 1}</td>
                            <td className="py-1.5 pr-2 tabular-nums">
                              <span className={p.score / p.max >= 0.6 ? 'text-emerald-600' : p.score / p.max >= 0.4 ? 'text-amber-600' : 'text-red-600'}>
                                {p.score}/{p.max}
                              </span>
                            </td>
                            <td className="py-1.5 text-black/70 dark:text-white/70">{p.notes || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="card text-center">
                <Gauge value={result.overallScore} />
                <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Final score</div>
                <div className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                  result.recommendation === 'HIRE' ? 'bg-emerald-500/15 text-emerald-600'
                  : result.recommendation === 'NO_HIRE' ? 'bg-red-500/15 text-red-600'
                  : 'bg-amber-500/15 text-amber-600'}`}>
                  {result.recommendation.replace('_', ' ')}
                </div>
              </div>
              <div className="card">
                <div className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Competency radar</div>
                <Radar competencies={result.competencies} />
                <div className="flex items-center justify-center gap-4 text-[10px] text-black/50 dark:text-white/50">
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-brand-500" /> Candidate</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-black/30 dark:bg-white/30" /> Benchmark</span>
                </div>
              </div>
              <div className="card">
                <div className="flex items-center gap-1.5 text-sm font-semibold"><ShieldIcon width={16} height={16} /> Integrity report</div>
                <div className="mt-1 text-2xl font-bold">{integrity}<span className="text-sm font-normal text-black/50 dark:text-white/50">/100</span></div>
                <div className="mt-2 space-y-1 text-xs">
                  <FlagRow label="Tab switches" n={flags.tabSwitch} />
                  <FlagRow label="Eye shift / away" n={flags.eyeShift} />
                  <FlagRow label="Multiple faces" n={flags.multiFace} />
                  <FlagRow label="Paste / AI-assist" n={flags.aiAssist} />
                  <FlagRow label="Second voice" n={flags.secondVoice} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────── LIVE ROOM ───────────────────────────────
  const q = questions[idx];
  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-white">
      {/* top bar */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="font-semibold">{topic.label} · Interview</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
            <ShieldIcon width={12} height={12} /> Proctoring Enabled
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="tabular-nums rounded-lg bg-white/10 px-3 py-1 text-sm font-medium">{fmt(remaining)}</span>
          <button onClick={endInterview} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium hover:bg-red-700">End Interview</button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden p-3 lg:grid-cols-[340px_1fr_300px]">
        {/* question / problem panel */}
        <div className="overflow-y-auto rounded-xl bg-white/5 p-4">
          {tab === 'code' && coding ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-white/50">Coding Challenge</span>
                <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-xs text-brand-400">{difficulty}</span>
              </div>
              <h3 className="mt-2 font-semibold">{coding.title}</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/80">{coding.statement}</p>
              {coding.inputFormat && <p className="mt-2 text-xs text-white/50"><b>Input:</b> {coding.inputFormat}</p>}
              {coding.outputFormat && <p className="mt-1 text-xs text-white/50"><b>Output:</b> {coding.outputFormat}</p>}
              <div className="mt-3 space-y-2">
                {coding.tests.filter((t) => !t.hidden).map((t, i) => (
                  <div key={i} className="rounded-lg bg-black/30 p-2 text-xs">
                    <div className="text-white/40">Sample {i + 1}</div>
                    <div className="mt-1 grid grid-cols-2 gap-2 font-mono">
                      <div><div className="text-white/40">stdin</div><pre className="whitespace-pre-wrap text-white/80">{t.input}</pre></div>
                      <div><div className="text-white/40">stdout</div><pre className="whitespace-pre-wrap text-white/80">{t.output}</pre></div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-white/50">Question {idx + 1}/{questions.length}</span>
                <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-xs text-brand-400">{difficulty}</span>
              </div>
              <h3 className="mt-2 font-semibold">{q?.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/80">{q?.prompt}</p>
            </>
          )}
        </div>

        {/* editor + transcript */}
        <div className="flex min-h-0 flex-col gap-3">
          {/* tab bar */}
          <div className="flex gap-1 rounded-xl bg-white/5 p-1 text-sm">
            <button onClick={() => setTab('qa')} className={`flex-1 rounded-lg px-3 py-1.5 ${tab === 'qa' ? 'bg-white/15 font-medium' : 'text-white/60'}`}>Interview Q&amp;A</button>
            {coding && (
              <button onClick={() => setTab('code')} className={`flex-1 rounded-lg px-3 py-1.5 ${tab === 'code' ? 'bg-white/15 font-medium' : 'text-white/60'}`}>
                Coding {codeResult && <span className={codeResult.passed === codeResult.total ? 'text-emerald-400' : 'text-amber-400'}>· {codeResult.passed}/{codeResult.total}</span>}
              </button>
            )}
          </div>

          {tab === 'code' && coding ? (
            <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-white/5">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <CodeIcon width={16} height={16} /> Code Editor
                  <select value={codeLang} onChange={(e) => { setCodeLang(e.target.value); setCodeSrc(coding.starter?.[e.target.value] ?? codeSrc); }}
                    className="rounded-md border border-white/15 bg-transparent px-1.5 py-0.5 text-xs">
                    {Object.keys(coding.starter ?? {}).filter((l) => CODE_LANGUAGES.includes(l)).map((l) => <option key={l} value={l} className="bg-neutral-900">{l}</option>)}
                  </select>
                </div>
                <button onClick={runCode} disabled={codeRunning} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium hover:bg-emerald-700 disabled:opacity-60">
                  {codeRunning ? 'Running…' : '▶ Run'}
                </button>
              </div>
              <textarea
                value={codeSrc}
                onChange={(e) => setCodeSrc(e.target.value)}
                onPaste={() => bumpFlag('aiAssist', 'Pasting is flagged as possible AI assistance.', 800)}
                spellCheck={false}
                placeholder="Write your solution — read stdin, print stdout…"
                className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-sm outline-none placeholder:text-white/30"
              />
              {codeResult && (
                <div className="max-h-40 overflow-y-auto border-t border-white/10 p-3 text-xs">
                  <div className="mb-1 font-medium">{codeResult.passed}/{codeResult.total} tests passed</div>
                  {codeResult.results.map((r) => (
                    <div key={r.ordinal} className="flex items-start justify-between gap-2 border-t border-white/5 py-1">
                      <span className={`inline-flex items-center gap-1 ${r.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                        {r.passed ? <CheckIcon width={12} height={12} /> : <XIcon width={12} height={12} />}
                        {r.hidden ? `Hidden #${r.ordinal + 1}` : `Sample #${r.ordinal + 1}`} · {r.status}
                      </span>
                      {!r.hidden && !r.passed && r.actual !== undefined && (
                        <span className="text-right font-mono text-white/50">got: {String(r.actual).slice(0, 40) || '∅'}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-white/5">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <CodeIcon width={16} height={16} /> Scratchpad
                  <select value={language} onChange={(e) => setLanguage(e.target.value)}
                    className="rounded-md border border-white/15 bg-transparent px-1.5 py-0.5 text-xs">
                    {LANGUAGES.map((l) => <option key={l} value={l} className="bg-neutral-900">{l}</option>)}
                  </select>
                </div>
                <span className="text-xs text-white/40">Type or speak your answer</span>
              </div>
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onPaste={() => bumpFlag('aiAssist', 'Pasting is flagged as possible AI assistance.', 800)}
                spellCheck={false}
                placeholder="Explain your approach here, or write code…"
                className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-sm outline-none placeholder:text-white/30"
              />
              <div className="flex items-center justify-between border-t border-white/10 px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-white/60">
                  {voiceState === 'speaking' ? <><SpeakerIcon width={14} height={14} className="text-brand-400" /> Interviewer speaking…</>
                    : voiceState === 'listening' ? <><MicIcon width={14} height={14} className="text-emerald-400" /> Listening…</>
                    : 'Ready'}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setMuted((m) => !m)} className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs hover:bg-white/20">
                    {muted ? 'Unmute AI' : 'Mute AI'}
                  </button>
                  <button onClick={() => setMicOn((m) => !m)} className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs hover:bg-white/20">
                    {micOn ? 'Mic on' : 'Mic off'}
                  </button>
                  <button onClick={submitAnswer} className="btn-primary text-xs">
                    {idx + 1 < questions.length ? 'Submit & next' : 'Submit & finish'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="max-h-24 overflow-y-auto rounded-xl bg-white/5 p-3 text-sm">
            {transcript.length === 0 ? <span className="text-white/40">Conversation transcript…</span> :
              transcript.slice(-5).map((t, i) => (
                <div key={i} className="mb-1">
                  <span className={t.role === 'ai' ? 'text-brand-400' : 'text-emerald-400'}>{t.role === 'ai' ? 'AI' : 'You'}:</span>{' '}
                  <span className="text-white/80">{t.text}</span>
                </div>
              ))}
          </div>
        </div>

        {/* webcam + proctoring flags */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> REC
            </span>
          </div>
          <div className="rounded-xl bg-white/5 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/50">Live signals</span>
              <span className={`text-xs font-semibold ${integrity >= 80 ? 'text-emerald-400' : integrity >= 55 ? 'text-amber-400' : 'text-red-400'}`}>{integrity}/100</span>
            </div>
            <div className="mt-2 space-y-1.5">
              <Signal label="Eye Shift" n={flags.eyeShift} tone="red" />
              <Signal label="Switched Tabs" n={flags.tabSwitch} tone="amber" />
              <Signal label="AI-Assist Detected" n={flags.aiAssist} tone="red" />
              <Signal label="Second Voice" n={flags.secondVoice} tone="amber" />
              <Signal label="Multiple Faces" n={flags.multiFace} tone="red" />
            </div>
            {!(window as any)?.FaceDetector && (
              <p className="mt-2 text-[10px] leading-tight text-white/35">Face/gaze detection uses your browser&apos;s vision API (best on Chrome). Tab-switch, paste & audio checks always run.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function Signal({ label, n, tone }: { label: string; n: number; tone: 'red' | 'amber' }) {
  const active = n > 0;
  const color = tone === 'red' ? 'text-red-400' : 'text-amber-400';
  return (
    <div className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-xs ${active ? 'bg-white/10' : 'bg-white/[0.03]'}`}>
      <span className={`inline-flex items-center gap-1.5 ${active ? color : 'text-white/40'}`}>
        {active ? <AlertIcon width={12} height={12} /> : <CheckIcon width={12} height={12} />}
        {label}
      </span>
      {active && <span className={`tabular-nums font-semibold ${color}`}>{n}</span>}
    </div>
  );
}

function FlagRow({ label, n }: { label: string; n: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-black/60 dark:text-white/60">{label}</span>
      <span className={`tabular-nums font-medium ${n > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{n}</span>
    </div>
  );
}

function Gauge({ value }: { value: number }) {
  const angle = (Math.min(100, Math.max(0, value)) / 100) * 180;
  const r = 52, cx = 60, cy = 60;
  const rad = (deg: number) => (deg - 180) * (Math.PI / 180);
  const x = cx + r * Math.cos(rad(angle));
  const y = cy + r * Math.sin(rad(angle));
  const color = value >= 75 ? '#10b981' : value >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <svg viewBox="0 0 120 70" className="mx-auto w-40">
      <path d="M8 60 A52 52 0 0 1 112 60" fill="none" stroke="currentColor" strokeWidth="8" className="text-black/10 dark:text-white/10" strokeLinecap="round" />
      <path d={`M8 60 A52 52 0 0 1 ${x} ${y}`} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
      <text x="60" y="52" textAnchor="middle" className="fill-current text-[20px] font-bold">{value}</text>
    </svg>
  );
}

/** Candidate-vs-benchmark competency radar (benchmark = fixed 70 baseline). */
function Radar({ competencies }: { competencies: Record<string, number> }) {
  const entries = Object.entries(competencies);
  const n = entries.length;
  const cx = 90, cy = 90, R = 62, benchmark = 70;
  const point = (i: number, value: number) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    const rr = (Math.min(100, Math.max(0, value)) / 100) * R;
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)] as const;
  };
  const poly = (fn: (i: number) => readonly [number, number]) =>
    entries.map((_, i) => fn(i).join(',')).join(' ');
  const label = (i: number) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + (R + 12) * Math.cos(a), cy + (R + 12) * Math.sin(a)] as const;
  };
  return (
    <svg viewBox="0 0 180 180" className="mx-auto w-full max-w-[220px]">
      {[0.33, 0.66, 1].map((f) => (
        <polygon key={f} points={poly((i) => point(i, f * 100))} fill="none" stroke="currentColor" className="text-black/10 dark:text-white/15" strokeWidth="0.8" />
      ))}
      <polygon points={poly((i) => point(i, benchmark))} fill="none" stroke="currentColor" className="text-black/30 dark:text-white/30" strokeWidth="1.2" strokeDasharray="3 2" />
      <polygon points={poly((i) => point(i, entries[i][1]))} fill="rgb(249 115 22 / 0.2)" stroke="#f97316" strokeWidth="1.6" />
      {entries.map(([k], i) => {
        const [lx, ly] = label(i);
        return <text key={k} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-current text-[7px] capitalize text-black/50 dark:text-white/50">{k.replace(/([A-Z])/g, ' $1').trim().split(' ')[0]}</text>;
      })}
    </svg>
  );
}

export default function InterviewRoom() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-black/50 dark:text-white/50">Loading…</div>}>
      <InterviewRoomInner />
    </Suspense>
  );
}
