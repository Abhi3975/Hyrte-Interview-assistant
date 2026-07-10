'use client';

/**
 * Conversational, proctored AI interview room.
 *
 * The AI interviewer (persona lives server-side in /practice/interview/turn)
 * greets the candidate, takes their introduction, asks one question at a time
 * with context, gives progressive hints, reviews code, and ends with a full
 * report. The candidate replies by typing or speaking; a coding tab compiles
 * & runs real code (or SQL). Webcam + client-side proctoring run throughout,
 * and the whole session is recorded to the DB for later review.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';
import { MicIcon, SpeakerIcon, ShieldIcon, AlertIcon, CheckIcon, XIcon, CodeIcon } from '@/components/icons';

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
const QUESTION_COUNTS = [3, 5, 8, 10];
const PERSONALITIES: { id: string; label: string }[] = [
  { id: 'friendly', label: 'Friendly' },
  { id: 'professional', label: 'Professional' },
  { id: 'strict', label: 'Strict' },
  { id: 'faang', label: 'FAANG' },
  { id: 'startup', label: 'Startup' },
  { id: 'pressure', label: 'High-pressure' },
];
const CODE_LANGUAGES = ['python', 'javascript', 'java', 'cpp', 'go', 'sql'];
const CODE_CATEGORIES = new Set(['DSA', 'BACKEND', 'FRONTEND', 'AI_ML', 'SQL', 'DATA_ANALYTICS']);
const SQL_CATEGORIES = new Set(['SQL']);

interface CodingTest { input: string; output: string; hidden: boolean }
interface CodingProblem { title: string; statement: string; inputFormat: string; outputFormat: string; starter: Record<string, string>; tests: CodingTest[] }
interface CaseResult { ordinal: number; passed: boolean; hidden: boolean; status: string; stderr?: string | null; expected?: string; actual?: string }
interface RunResult { passed: number; total: number; results: CaseResult[] }
interface Msg { role: 'ai' | 'you'; text: string }
interface Evaluation {
  overallScore: number; competencies: Record<string, number>;
  strengths: string[]; weaknesses: string[]; summary: string; recommendation: string;
  perQuestion?: { score: number; max: number; notes: string }[];
}
type Phase = 'setup' | 'lobby' | 'live' | 'evaluating' | 'result';
interface Flags { tabSwitch: number; eyeShift: number; multiFace: number; aiAssist: number; secondVoice: number }
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

  // Recruiter-assigned assessment: launched from /interview/<code> with config.
  const assessmentId = params.get('assessment') || null;
  const aCat = params.get('cat'); const aRole = params.get('role'); const aDiff = params.get('diff'); const aDur = params.get('dur');
  const assessmentTopic = assessmentId && aCat ? { label: aRole || 'Interview', category: aCat, topic: aRole || aCat, blurb: '' } : null;
  const resumeContextRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (assessmentId && typeof window !== 'undefined') {
      resumeContextRef.current = sessionStorage.getItem(`resume:${assessmentId}`) ?? undefined;
    }
  }, [assessmentId]);

  const [phase, setPhase] = useState<Phase>(assessmentId || hasTopicParam ? 'lobby' : 'setup');
  const [topicIdx, setTopicIdx] = useState(hasTopicParam ? topicParam : 0);
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>((aDiff as any) || 'MEDIUM');
  const [durationMin, setDurationMin] = useState(aDur ? Number(aDur) : 20);
  const [numQuestions, setNumQuestions] = useState(5);
  const [personality, setPersonality] = useState('professional');

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [voiceState, setVoiceState] = useState<'idle' | 'speaking' | 'listening'>('idle');
  const [micOn, setMicOn] = useState(true);
  const [muted, setMuted] = useState(false);

  const [tab, setTab] = useState<'chat' | 'code'>('chat');
  const [coding, setCoding] = useState<CodingProblem | null>(null);
  const [codeLang, setCodeLang] = useState('python');
  const [codeSrc, setCodeSrc] = useState('');
  const [codeResult, setCodeResult] = useState<RunResult | null>(null);
  const [codeRunning, setCodeRunning] = useState(false);

  const [flags, setFlags] = useState<Flags>(ZERO_FLAGS);
  const [remaining, setRemaining] = useState(durationMin * 60);
  const [result, setResult] = useState<Evaluation | null>(null);
  const [report, setReport] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const endedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Msg[]>([]);
  const lastAiTsRef = useRef(0);
  const behaviorRef = useRef<{ turns: { thinkingMs: number; words: number }[]; hints: number }>({ turns: [], hints: 0 });
  const [behavior, setBehavior] = useState<{ avgThinkingSec: number; avgWords: number; hintsUsed: number; responses: number; tabSwitches: number } | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const voiceStateRef = useRef(voiceState);
  const flagCooldown = useRef<Record<string, number>>({});
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendTurnRef = useRef<((t?: string, o?: { end?: boolean; behaviorSummary?: string }) => void) | null>(null);
  const sendingRef = useRef(false);
  const micOnRef = useRef(micOn);

  const topic = assessmentTopic ?? TOPICS[topicIdx];
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);
  useEffect(() => { sendingRef.current = sending; }, [sending]);
  useEffect(() => { micOnRef.current = micOn; }, [micOn]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  useEffect(() => {
    if (hydrated && !user) {
      const nextPath = `/candidate/interview${hasTopicParam ? `?topic=${topicParam}` : ''}`;
      router.replace(`/signup?next=${encodeURIComponent(nextPath)}`);
    }
  }, [hydrated, user, router, hasTopicParam, topicParam]);

  const teardown = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    try { recognitionRef.current?.stop?.(); } catch {}
    recognitionRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch {}
    audioCtxRef.current?.close?.().catch(() => {});
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => () => teardown(), [teardown]);

  // Warm up the speech-synthesis voice list so Ally's voice is ready.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.getVoices();
    const h = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', h);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', h);
  }, []);

  function bumpFlag(key: keyof Flags, cooldownMs = 1500) {
    const now = Date.now();
    if (now - (flagCooldown.current[key] ?? 0) < cooldownMs) return;
    flagCooldown.current[key] = now;
    setFlags((f) => ({ ...f, [key]: f[key] + 1 }));
  }

  const speak = useCallback((text: string) => {
    if (muted || typeof window === 'undefined' || !window.speechSynthesis) { setVoiceState('listening'); return; }
    setVoiceState('speaking');
    // strip emoji/markdown for cleaner TTS
    const clean = text.replace(/[#*`_>]/g, '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
    const u = new SpeechSynthesisUtterance(clean);
    // Ally has a female voice — pick the best available.
    const voices = window.speechSynthesis.getVoices();
    const prefer = ['samantha', 'ally', 'google uk english female', 'microsoft zira', 'microsoft aria', 'victoria', 'karen', 'moira', 'tessa', 'fiona', 'serena', 'female'];
    const female = prefer.map((p) => voices.find((v) => v.name.toLowerCase().includes(p) && v.lang.startsWith('en'))).find(Boolean)
      ?? voices.find((v) => v.lang.startsWith('en'));
    if (female) u.voice = female;
    u.rate = 1.02;
    u.pitch = 1.15;
    u.onend = () => setVoiceState('listening');
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }, [muted]);

  const startListening = useCallback(() => {
    const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Ctor || !micOnRef.current) return;
    if (recognitionRef.current) return; // already listening
    try { recognitionRef.current?.stop?.(); } catch {}
    const rec = new Ctor();
    rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
    let finalChunk = '';
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalChunk += r[0].transcript + ' '; else interim += r[0].transcript;
      }
      const text = (finalChunk + interim).trim();
      const words = text.split(/\s+/).filter(Boolean).length;
      // Barge-in: if the candidate speaks while Ally is talking, stop her and listen.
      if (voiceStateRef.current === 'speaking' && words >= 2) {
        try { window.speechSynthesis?.cancel(); } catch {}
        setVoiceState('listening');
      }
      setInput(text);
      // VAD: ~900ms of silence = end of turn → auto-send.
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        if (text && words >= 1 && !sendingRef.current && voiceStateRef.current !== 'speaking') {
          sendTurnRef.current?.(text);
          finalChunk = '';
        }
      }, 900);
    };
    rec.onerror = () => {};
    // Keep listening continuously — restart if the engine ends on its own.
    rec.onend = () => {
      if (recognitionRef.current === rec && !endedRef.current && micOnRef.current) {
        try { rec.start(); } catch {}
      }
    };
    recognitionRef.current = rec;
    try { rec.start(); } catch {}
  }, []);

  // Mic stays hot the whole interview (both while Ally speaks — for barge-in —
  // and while listening), so it feels like a real call, never press-to-send.
  useEffect(() => {
    if (phase !== 'live') return;
    if (micOn && tab === 'chat') startListening();
    else { const r = recognitionRef.current; recognitionRef.current = null; try { r?.stop?.(); } catch {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, micOn, tab, startListening]);

  // timer
  useEffect(() => {
    if (phase !== 'live') return;
    const iv = setInterval(() => setRemaining((r) => { if (r <= 1) { clearInterval(iv); endInterview(); return 0; } return r - 1; }), 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // proctoring: tab / focus
  useEffect(() => {
    if (phase !== 'live') return;
    const onHidden = () => { if (document.hidden) bumpFlag('tabSwitch'); };
    const onBlur = () => bumpFlag('tabSwitch');
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('blur', onBlur);
    return () => { document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('blur', onBlur); };
  }, [phase]);

  // proctoring: face/gaze via FaceDetector
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
        if (faces.length === 0) bumpFlag('eyeShift', 4000);
        else if (faces.length > 1) bumpFlag('multiFace', 4000);
        else {
          const box = faces[0].boundingBox;
          const cx = box.x + box.width / 2; const w = videoRef.current.videoWidth || 640;
          if (cx < w * 0.28 || cx > w * 0.72) bumpFlag('eyeShift', 4000);
        }
      } catch {}
      setTimeout(loop, 1200);
    };
    loop();
    return () => { stop = true; };
  }, [phase]);

  const integrity = useMemo(() => {
    const p = flags.tabSwitch * 6 + flags.eyeShift * 3 + flags.multiFace * 12 + flags.aiAssist * 10 + flags.secondVoice * 8;
    return Math.max(0, 100 - p);
  }, [flags]);

  // ── conversational turn ──
  const sendTurn = useCallback(async (candidateText?: string, opts?: { end?: boolean; behaviorSummary?: string }) => {
    const base = messagesRef.current.slice();
    if (candidateText && candidateText.trim()) {
      base.push({ role: 'you', text: candidateText.trim() });
      // Behavior signals: thinking time (since the AI finished) + answer length.
      const thinkingMs = lastAiTsRef.current ? Date.now() - lastAiTsRef.current : 0;
      const words = candidateText.trim().split(/\s+/).filter(Boolean).length;
      behaviorRef.current.turns.push({ thinkingMs, words });
      if (/stuck|explain|hint|don'?t know|no idea|help me/i.test(candidateText)) behaviorRef.current.hints++;
    }
    setMessages(base);
    setInput('');
    setSending(true);
    try {
      const res = await api.post<{ text: string }>('/practice/interview/turn', {
        jobRole: topic.label, category: topic.category, difficulty, topic: topic.topic,
        count: numQuestions, personality, candidateName: user?.fullName?.split(' ')[0], resumeContext: resumeContextRef.current,
        transcript: base.map((m) => ({ role: m.role === 'ai' ? 'interviewer' : 'candidate', content: m.text })),
        end: opts?.end ?? false, behaviorSummary: opts?.behaviorSummary,
      });
      if (opts?.end) return res.text;
      setMessages((m) => [...m, { role: 'ai', text: res.text }]);
      speak(res.text);
      lastAiTsRef.current = Date.now();
      return res.text;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The interviewer could not respond.');
      return '';
    } finally {
      setSending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, difficulty, numQuestions, personality, user, speak]);
  useEffect(() => { sendTurnRef.current = sendTurn; }, [sendTurn]);

  function onSend() {
    if (!input.trim() || sending) return;
    sendTurn(input);
  }

  async function runCode() {
    if (!coding) return;
    setCodeRunning(true); setCodeResult(null);
    try {
      const res = await api.post<RunResult>('/practice/coding/run', { language: codeLang, code: codeSrc, tests: coding.tests });
      setCodeResult(res);
    } catch (err) { setError(err instanceof Error ? err.message : 'Code run failed'); }
    finally { setCodeRunning(false); }
  }

  function shareCode() {
    const pass = codeResult ? `(${codeResult.passed}/${codeResult.total} tests passed)` : '(not run yet)';
    setTab('chat');
    sendTurn(`Here is my ${codeLang} solution ${pass}. Please review it:\n\n${codeSrc}`);
  }

  async function start() {
    setError(''); setLoading(true);
    setFlags(ZERO_FLAGS); setMessages([]); setInput(''); setReport('');
    endedRef.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(window.isSecureContext ? 'Camera/microphone are not available in this browser.' : 'Camera & mic need a secure (HTTPS) connection. Open this site over https:// and allow permissions.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      try {
        const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
        const ctx: AudioContext = new Ctx(); audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream); const analyser = ctx.createAnalyser();
        analyser.fftSize = 512; src.connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount); let loud = 0;
        const meter = () => {
          if (endedRef.current) return;
          analyser.getByteTimeDomainData(buf);
          let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / buf.length);
          if (voiceStateRef.current === 'speaking' && rms > 0.14) { loud++; if (loud > 25) { bumpFlag('secondVoice', 6000); loud = 0; } } else loud = Math.max(0, loud - 1);
          requestAnimationFrame(meter);
        };
        meter();
      } catch {}

      try {
        const s = await api.post<{ sessionId: string }>('/practice/session', { category: topic.category, difficulty, topic: topic.topic, jobRole: topic.label, interviewId: assessmentId ?? undefined });
        sessionIdRef.current = s.sessionId;
      } catch { sessionIdRef.current = null; }

      if (CODE_CATEGORIES.has(topic.category)) {
        const kind = SQL_CATEGORIES.has(topic.category) ? 'sql' : 'code';
        try {
          const prob = await api.post<CodingProblem>('/practice/coding/generate', { topic: topic.topic, difficulty, kind });
          if (prob?.tests?.length) {
            setCoding(prob);
            const langs = Object.keys(prob.starter ?? {});
            const lang = prob.starter?.python ? 'python' : langs[0] ?? 'python';
            setCodeLang(lang); setCodeSrc(prob.starter?.[lang] ?? '');
          }
        } catch {}
      }
      setRemaining(durationMin * 60);
      setPhase('live');
      sendTurn(); // AI greeting + asks for intro
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not access camera/microphone.');
      setPhase('lobby'); teardown();
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (phase === 'live' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [phase]);

  function endInterview() { if (!endedRef.current) finalize(); }

  async function finalize() {
    if (endedRef.current) return;
    endedRef.current = true;
    setPhase('evaluating');
    try { recognitionRef.current?.stop?.(); } catch {}
    try {
      // Aggregate behavior signals from the conversation.
      const b = behaviorRef.current;
      const avgThinkingSec = b.turns.length ? Math.round(b.turns.reduce((a, t) => a + t.thinkingMs, 0) / b.turns.length / 1000) : 0;
      const avgWords = b.turns.length ? Math.round(b.turns.reduce((a, t) => a + t.words, 0) / b.turns.length) : 0;
      const beh = { avgThinkingSec, avgWords, hintsUsed: b.hints, responses: b.turns.length, tabSwitches: flags.tabSwitch };
      setBehavior(beh);
      const behaviorSummary = `${beh.responses} responses; avg thinking time ${avgThinkingSec}s; avg answer length ${avgWords} words; hints used ${b.hints}; tab switches ${flags.tabSwitch}; integrity ${integrity}/100`;
      const rep = await sendTurn(undefined, { end: true, behaviorSummary });
      if (rep) setReport(rep);
      // Build scored answers from the conversation (each candidate turn vs the preceding AI prompt).
      const convo = messagesRef.current;
      const answers: { prompt: string; response: string }[] = [];
      for (let i = 0; i < convo.length; i++) {
        if (convo[i].role === 'you') {
          const prompt = i > 0 && convo[i - 1].role === 'ai' ? convo[i - 1].text : 'Interview discussion';
          answers.push({ prompt: prompt.slice(0, 500), response: convo[i].text });
        }
      }
      if (coding && codeSrc.trim()) {
        answers.push({ prompt: `Coding challenge — ${coding.title}`, response: `Language: ${codeLang}\n${codeResult ? `[${codeResult.passed}/${codeResult.total} tests passed]` : '[not run]'}\n\n${codeSrc}` });
      }
      const payload = answers.length ? answers : [{ prompt: 'Interview', response: '(no answers recorded)' }];
      const evalRes = sessionIdRef.current
        ? await api.post<Evaluation>(`/practice/session/${sessionIdRef.current}/complete`, { category: topic.category, difficulty, jobRole: topic.label, answers: payload, flags, integrity, behavior: beh })
        : await api.post<Evaluation>('/practice/evaluate', { category: topic.category, difficulty, jobRole: topic.label, answers: payload });
      setResult(evalRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evaluation failed.');
    } finally {
      teardown();
      setPhase('result');
    }
  }

  if (!hydrated || !user) return <div className="flex min-h-screen items-center justify-center text-sm text-black/50 dark:text-white/50">Loading…</div>;

  // ───────── SETUP ─────────
  if (phase === 'setup') {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Start an AI Interview</h1>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">A real, conversational interviewer — greets you, asks one question at a time, hints when you&apos;re stuck, and reviews your code.</p>
          </div>
          <ThemeToggle />
        </div>
        {error && <p className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOPICS.map((t, i) => (
            <button key={t.label} onClick={() => setTopicIdx(i)} className={`card text-left transition ${i === topicIdx ? 'ring-2 ring-brand-500' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'}`}>
              <div className="flex items-center gap-2 font-semibold"><CodeIcon width={18} height={18} className="text-brand-500" />{t.label}</div>
              <p className="mt-1 text-xs text-black/55 dark:text-white/55">{t.blurb}</p>
            </button>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-end gap-6">
          <Picker label="Difficulty" options={DIFFICULTIES as unknown as string[]} value={difficulty} onChange={(v) => setDifficulty(v as any)} render={(d) => d[0] + d.slice(1).toLowerCase()} />
          <Picker label="Duration" options={['10', '20', '30']} value={String(durationMin)} onChange={(v) => { setDurationMin(Number(v)); setRemaining(Number(v) * 60); }} render={(m) => `${m} min`} />
          <Picker label="Questions" options={QUESTION_COUNTS.map(String)} value={String(numQuestions)} onChange={(v) => setNumQuestions(Number(v))} render={(c) => c} />
          <Picker label="Interviewer" options={PERSONALITIES.map((p) => p.id)} value={personality} onChange={setPersonality} render={(id) => PERSONALITIES.find((p) => p.id === id)?.label ?? id} />
        </div>
        <div className="mt-6 flex items-center gap-3">
          <button onClick={() => setPhase('lobby')} className="btn-primary">Continue to {topic.label} interview</button>
          <span className="inline-flex items-center gap-1.5 text-xs text-black/50 dark:text-white/50"><ShieldIcon width={14} height={14} /> Camera, mic & screen focus are monitored.</span>
        </div>
      </div>
    );
  }

  // ───────── LOBBY ─────────
  if (phase === 'lobby') {
    return (
      <div className="min-h-screen bg-neutral-950 px-4 py-8 text-white">
        <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
          <div className="rounded-2xl bg-white/5 p-6">
            <div className="text-lg font-bold">Interview<span className="text-brand-500">AI</span></div>
            <div className="mt-1 text-sm text-white/60">{topic.label} · {difficulty[0] + difficulty.slice(1).toLowerCase()} · Demo Interview</div>
            <div className="mt-6 text-xs font-semibold uppercase tracking-wide text-white/40">Interview Team</div>
            <div className="mt-2 space-y-2">
              <div className="rounded-xl bg-white/5 p-3 flex items-center gap-3">
                <AiAvatar size={40} />
                <div><div className="font-semibold">Ally · AI Interviewer</div><div className="text-xs text-white/60">Senior Engineer</div></div>
              </div>
              <div className="rounded-xl bg-white/5 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500/20 text-brand-300"><ShieldIcon width={18} height={18} /></div>
                  <div><div className="font-semibold">Proctor</div><div className="text-xs text-white/60">InterviewAI Integrity</div></div>
                </div>
                <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-amber-400"><ShieldIcon width={12} height={12} /> Reviews your complete interview recording</div>
              </div>
            </div>
            <div className="mt-6 text-xs font-semibold uppercase tracking-wide text-white/40">Interview Details</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/5 p-3"><div className="text-[10px] uppercase tracking-wide text-white/40">Time</div><div className="mt-0.5 font-semibold">{durationMin} mins</div></div>
              <div className="rounded-xl bg-white/5 p-3"><div className="text-[10px] uppercase tracking-wide text-white/40">Questions</div><div className="mt-0.5 font-semibold">{numQuestions}{CODE_CATEGORIES.has(topic.category) ? ' + coding' : ''}</div></div>
            </div>
          </div>
          <div className="flex flex-col justify-center rounded-2xl bg-white/5 p-6">
            <div className="flex items-center gap-3"><AiAvatar size={56} speaking /><div><h1 className="text-xl font-bold">Ready to start?</h1><p className="text-sm text-white/60">Ally will interview you live.</p></div></div>
            <p className="mt-4 text-sm text-white/60">Ally greets you, takes your intro, then asks {numQuestions} questions one at a time{CODE_CATEGORIES.has(topic.category) ? ' plus a live coding challenge' : ''} — with hints and feedback. Answer by speaking or typing.</p>
            {error && <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}
            <button onClick={start} disabled={loading} className="btn-primary mt-5 justify-center">{loading ? 'Requesting camera & mic…' : 'Start interview'}</button>
            <button onClick={() => setPhase('setup')} className="mt-2 text-center text-xs text-white/50">← Change role or difficulty</button>
          </div>
        </div>
      </div>
    );
  }

  // ───────── EVALUATING ─────────
  if (phase === 'evaluating') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        <p className="text-sm text-black/60 dark:text-white/60">Ally is writing your interview report…</p>
      </div>
    );
  }

  // ───────── RESULT ─────────
  if (phase === 'result') {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Interview Report</h1>
          <button onClick={() => setPhase('setup')} className="btn-ghost text-sm">New interview</button>
        </div>
        {error && <p className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
        <div className="grid gap-5 md:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            {report && (
              <div className="card">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50"><AiAvatar size={20} /> Ally&apos;s feedback</div>
                <div className="whitespace-pre-wrap text-sm leading-relaxed">{report}</div>
              </div>
            )}
            {result && (
              <div className="card">
                <div className="text-xs font-semibold text-black/50 dark:text-white/50">Competencies</div>
                <div className="mt-2 space-y-2">
                  {Object.entries(result.competencies).map(([k, v]) => (
                    <div key={k}>
                      <div className="flex justify-between text-xs capitalize"><span>{k.replace(/([A-Z])/g, ' $1')}</span><span className="tabular-nums">{v}</span></div>
                      <div className="mt-0.5 h-1.5 rounded-full bg-black/10 dark:bg-white/10"><div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, v)}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-4">
            {result && (
              <div className="card text-center">
                <Gauge value={result.overallScore} />
                <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Final score</div>
                <div className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${result.recommendation === 'HIRE' || result.recommendation === 'STRONG_HIRE' ? 'bg-emerald-500/15 text-emerald-600' : result.recommendation.includes('NO') ? 'bg-red-500/15 text-red-600' : 'bg-amber-500/15 text-amber-600'}`}>{result.recommendation.replace('_', ' ')}</div>
                <Radar competencies={result.competencies} />
              </div>
            )}
            {behavior && (
              <div className="card">
                <div className="text-sm font-semibold">Behavior profile</div>
                <div className="mt-2 space-y-1 text-xs [&>div]:flex [&>div]:items-center [&>div]:justify-between [&_span:first-child]:text-black/60 dark:[&_span:first-child]:text-white/60 [&_span:last-child]:tabular-nums [&_span:last-child]:font-medium">
                  <div><span>Responses given</span><span>{behavior.responses}</span></div>
                  <div><span>Avg thinking time</span><span>{behavior.avgThinkingSec}s</span></div>
                  <div><span>Avg answer length</span><span>{behavior.avgWords} words</span></div>
                  <div><span>Hints used</span><span>{behavior.hintsUsed}</span></div>
                </div>
              </div>
            )}
            <div className="card">
              <div className="flex items-center gap-1.5 text-sm font-semibold"><ShieldIcon width={16} height={16} /> Integrity report</div>
              <div className="mt-1 text-2xl font-bold">{integrity}<span className="text-sm font-normal text-black/50 dark:text-white/50">/100</span></div>
              <div className="mt-2 space-y-1 text-xs">
                <FlagRow label="Tab switches" n={flags.tabSwitch} /><FlagRow label="Eye shift / away" n={flags.eyeShift} />
                <FlagRow label="Multiple faces" n={flags.multiFace} /><FlagRow label="Paste / AI-assist" n={flags.aiAssist} /><FlagRow label="Second voice" n={flags.secondVoice} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ───────── LIVE ─────────
  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-white">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="font-semibold">{topic.label} · Interview</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400"><ShieldIcon width={12} height={12} /> Proctoring Enabled</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="tabular-nums rounded-lg bg-white/10 px-3 py-1 text-sm font-medium">{fmt(remaining)}</span>
          <button onClick={endInterview} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium hover:bg-red-700">End Interview</button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden p-3 lg:grid-cols-[1fr_300px]">
        {/* conversation / coding */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex gap-1 rounded-xl bg-white/5 p-1 text-sm">
            <button onClick={() => setTab('chat')} className={`flex-1 rounded-lg px-3 py-1.5 ${tab === 'chat' ? 'bg-white/15 font-medium' : 'text-white/60'}`}>Interview</button>
            {coding && <button onClick={() => setTab('code')} className={`flex-1 rounded-lg px-3 py-1.5 ${tab === 'code' ? 'bg-white/15 font-medium' : 'text-white/60'}`}>Coding {codeResult && <span className={codeResult.passed === codeResult.total ? 'text-emerald-400' : 'text-amber-400'}>· {codeResult.passed}/{codeResult.total}</span>}</button>}
          </div>

          {tab === 'code' && coding ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
              <div className="overflow-y-auto rounded-xl bg-white/5 p-4 lg:w-72">
                <div className="text-xs font-semibold uppercase tracking-wide text-white/50">Coding Challenge</div>
                <h3 className="mt-2 font-semibold">{coding.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/80">{coding.statement}</p>
                <div className="mt-3 space-y-2">
                  {coding.tests.filter((t) => !t.hidden).map((t, i) => (
                    <div key={i} className="rounded-lg bg-black/30 p-2 text-xs font-mono"><div className="text-white/40">Sample {i + 1}</div><div className="mt-1 grid grid-cols-2 gap-2"><div><div className="text-white/40">in</div><pre className="whitespace-pre-wrap text-white/80">{t.input}</pre></div><div><div className="text-white/40">out</div><pre className="whitespace-pre-wrap text-white/80">{t.output}</pre></div></div></div>
                  ))}
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-white/5">
                <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm"><CodeIcon width={16} height={16} /> Editor
                    <select value={codeLang} onChange={(e) => { setCodeLang(e.target.value); setCodeSrc(coding.starter?.[e.target.value] ?? codeSrc); }} className="rounded-md border border-white/15 bg-transparent px-1.5 py-0.5 text-xs">
                      {Object.keys(coding.starter ?? {}).filter((l) => CODE_LANGUAGES.includes(l)).map((l) => <option key={l} value={l} className="bg-neutral-900">{l}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={runCode} disabled={codeRunning} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium hover:bg-emerald-700 disabled:opacity-60">{codeRunning ? 'Running…' : '▶ Run'}</button>
                    <button onClick={shareCode} className="rounded-lg bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20">Ask Ally to review</button>
                  </div>
                </div>
                <textarea value={codeSrc} onChange={(e) => setCodeSrc(e.target.value)} onPaste={() => bumpFlag('aiAssist', 800)} spellCheck={false} placeholder="Write your solution…" className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-sm outline-none placeholder:text-white/30" />
                {codeResult && (
                  <div className="max-h-32 overflow-y-auto border-t border-white/10 p-3 text-xs">
                    <div className="mb-1 font-medium">{codeResult.passed}/{codeResult.total} tests passed</div>
                    {codeResult.results.map((r) => (
                      <div key={r.ordinal} className="flex items-center gap-1 border-t border-white/5 py-1">
                        <span className={`inline-flex items-center gap-1 ${r.passed ? 'text-emerald-400' : 'text-red-400'}`}>{r.passed ? <CheckIcon width={12} height={12} /> : <XIcon width={12} height={12} />}{r.hidden ? `Hidden #${r.ordinal + 1}` : `Sample #${r.ordinal + 1}`} · {r.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-white/5 p-4">
                {messages.length === 0 && !sending && <div className="flex h-full items-center justify-center text-sm text-white/40">Connecting you with Ally…</div>}
                <div className="space-y-3">
                  {messages.map((m, i) => (
                    <div key={i} className={`flex gap-2 ${m.role === 'you' ? 'justify-end' : 'justify-start'}`}>
                      {m.role === 'ai' && <AiAvatar size={28} />}
                      <div className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed ${m.role === 'ai' ? 'bg-white/10' : 'bg-brand-500 text-white'}`}>{m.text}</div>
                    </div>
                  ))}
                  {sending && <div className="flex gap-2"><AiAvatar size={28} /><div className="rounded-2xl bg-white/10 px-4 py-2 text-sm text-white/60">Ally is thinking…</div></div>}
                  <div ref={chatEndRef} />
                </div>
              </div>
              <div className="rounded-xl bg-white/5 p-2">
                <div className="mb-1.5 flex items-center gap-2 px-1 text-xs text-white/50">
                  {voiceState === 'speaking' ? <><SpeakerIcon width={14} height={14} className="text-brand-400" /> Ally is speaking…</> : voiceState === 'listening' ? <><MicIcon width={14} height={14} className="text-emerald-400" /> Listening — speak or type</> : 'Ready'}
                  <button onClick={() => sendTurn('I\'m a bit stuck — can you explain the question and give me a hint?')} disabled={sending} className="ml-auto rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/20">I&apos;m stuck — explain</button>
                </div>
                <div className="flex items-end gap-2">
                  <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }} onPaste={() => bumpFlag('aiAssist', 800)} rows={2} placeholder="Type your answer, or just speak…" className="min-h-0 flex-1 resize-none rounded-lg bg-black/30 p-2 text-sm outline-none placeholder:text-white/30" />
                  <div className="flex flex-col gap-1">
                    <button onClick={() => setMuted((m) => !m)} className="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/20">{muted ? 'Unmute' : 'Mute'}</button>
                    <button onClick={() => setMicOn((m) => !m)} className="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/20">{micOn ? 'Mic on' : 'Mic off'}</button>
                  </div>
                  <button onClick={onSend} disabled={sending || !input.trim()} className="btn-primary text-sm disabled:opacity-50">Send</button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* right column: AI + webcam + proctoring */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
            <AiAvatar size={44} speaking={voiceState === 'speaking'} />
            <div><div className="text-sm font-semibold">Ally</div><div className="text-xs text-white/50">AI Interviewer · Senior Engineer</div></div>
          </div>
          <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> REC</span>
          </div>
          <div className="rounded-xl bg-white/5 p-3">
            <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-white/50">Live signals</span><span className={`text-xs font-semibold ${integrity >= 80 ? 'text-emerald-400' : integrity >= 55 ? 'text-amber-400' : 'text-red-400'}`}>{integrity}/100</span></div>
            <div className="mt-2 space-y-1.5">
              <Signal label="Eye Shift" n={flags.eyeShift} tone="red" /><Signal label="Switched Tabs" n={flags.tabSwitch} tone="amber" />
              <Signal label="AI-Assist Detected" n={flags.aiAssist} tone="red" /><Signal label="Second Voice" n={flags.secondVoice} tone="amber" /><Signal label="Multiple Faces" n={flags.multiFace} tone="red" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Picker({ label, options, value, onChange, render }: { label: string; options: string[]; value: string; onChange: (v: string) => void; render: (v: string) => ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-black/60 dark:text-white/60">{label}</label>
      <div className="mt-1 flex gap-1">
        {options.map((o) => <button key={o} onClick={() => onChange(o)} className={`rounded-lg px-3 py-1.5 text-sm ${o === value ? 'bg-brand-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>{render(o)}</button>)}
      </div>
    </div>
  );
}

/** Illustrated AI-interviewer avatar (a friendly person), CSP-safe inline SVG. */
function AiAvatar({ size = 40, speaking = false }: { size?: number; speaking?: boolean }) {
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-full ${speaking ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-neutral-900' : ''}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width={size} height={size} className="rounded-full">
        <defs>
          <linearGradient id="aibg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6d5efc" /><stop offset="1" stopColor="#3b82f6" /></linearGradient>
        </defs>
        <rect width="64" height="64" rx="32" fill="url(#aibg)" />
        <circle cx="32" cy="26" r="11" fill="#f2d9c2" />
        <path d="M21 24a11 11 0 0 1 22 0c0-2-2-9-11-9s-11 7-11 9Z" fill="#3a2f2a" />
        <path d="M16 54c1-9 8-14 16-14s15 5 16 14a32 32 0 0 1-32 0Z" fill="#e2e8f0" />
        <path d="M26 27c1 1 3 1 4 0M34 27c1 1 3 1 4 0" stroke="#3a2f2a" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </svg>
      {speaking && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400 ring-2 ring-neutral-900" />}
    </span>
  );
}

function fmt(sec: number) { const m = Math.floor(sec / 60).toString().padStart(2, '0'); const s = (sec % 60).toString().padStart(2, '0'); return `${m}:${s}`; }

function Signal({ label, n, tone }: { label: string; n: number; tone: 'red' | 'amber' }) {
  const active = n > 0; const color = tone === 'red' ? 'text-red-400' : 'text-amber-400';
  return (
    <div className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-xs ${active ? 'bg-white/10' : 'bg-white/[0.03]'}`}>
      <span className={`inline-flex items-center gap-1.5 ${active ? color : 'text-white/40'}`}>{active ? <AlertIcon width={12} height={12} /> : <CheckIcon width={12} height={12} />}{label}</span>
      {active && <span className={`tabular-nums font-semibold ${color}`}>{n}</span>}
    </div>
  );
}

function FlagRow({ label, n }: { label: string; n: number }) {
  return <div className="flex items-center justify-between"><span className="text-black/60 dark:text-white/60">{label}</span><span className={`tabular-nums font-medium ${n > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{n}</span></div>;
}

function Gauge({ value }: { value: number }) {
  const angle = (Math.min(100, Math.max(0, value)) / 100) * 180;
  const r = 52, cx = 60, cy = 60; const rad = (d: number) => (d - 180) * (Math.PI / 180);
  const x = cx + r * Math.cos(rad(angle)); const y = cy + r * Math.sin(rad(angle));
  const color = value >= 75 ? '#10b981' : value >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <svg viewBox="0 0 120 70" className="mx-auto w-40">
      <path d="M8 60 A52 52 0 0 1 112 60" fill="none" stroke="currentColor" strokeWidth="8" className="text-black/10 dark:text-white/10" strokeLinecap="round" />
      <path d={`M8 60 A52 52 0 0 1 ${x} ${y}`} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
      <text x="60" y="52" textAnchor="middle" className="fill-current text-[20px] font-bold">{value}</text>
    </svg>
  );
}

function Radar({ competencies }: { competencies: Record<string, number> }) {
  const entries = Object.entries(competencies); const n = entries.length;
  const cx = 90, cy = 90, R = 60, benchmark = 70;
  const point = (i: number, value: number) => { const a = (Math.PI * 2 * i) / n - Math.PI / 2; const rr = (Math.min(100, Math.max(0, value)) / 100) * R; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)] as const; };
  const poly = (fn: (i: number) => readonly [number, number]) => entries.map((_, i) => fn(i).join(',')).join(' ');
  return (
    <svg viewBox="0 0 180 180" className="mx-auto mt-3 w-full max-w-[200px]">
      {[0.33, 0.66, 1].map((f) => <polygon key={f} points={poly((i) => point(i, f * 100))} fill="none" stroke="currentColor" className="text-black/10 dark:text-white/15" strokeWidth="0.8" />)}
      <polygon points={poly((i) => point(i, benchmark))} fill="none" stroke="currentColor" className="text-black/30 dark:text-white/30" strokeWidth="1.2" strokeDasharray="3 2" />
      <polygon points={poly((i) => point(i, entries[i][1]))} fill="rgb(249 115 22 / 0.2)" stroke="#f97316" strokeWidth="1.6" />
      {entries.map(([k], i) => { const a = (Math.PI * 2 * i) / n - Math.PI / 2; const lx = cx + (R + 11) * Math.cos(a); const ly = cy + (R + 11) * Math.sin(a); return <text key={k} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-current text-[7px] capitalize text-black/50 dark:text-white/50">{k.replace(/([A-Z])/g, ' $1').trim().split(' ')[0]}</text>; })}
    </svg>
  );
}

export default function InterviewRoom() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-black/50 dark:text-white/50">Loading…</div>}><InterviewRoomInner /></Suspense>;
}
