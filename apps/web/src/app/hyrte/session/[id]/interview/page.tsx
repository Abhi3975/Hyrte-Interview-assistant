'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { MicIcon, SpeakerIcon } from '@/components/icons';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { HyrteInterviewTurn } from '@/lib/hyrte-types';

interface TranscriptResponse {
  phase: string;
  transcript: HyrteInterviewTurn[];
}

/**
 * §5.8 Living Interviewer voice layer. STT reuses the browser's native
 * SpeechRecognition, same as the main "Ally" room. TTS is real neural
 * synthesis (ElevenLabs, via POST /voice/speak) — browser SpeechSynthesis
 * is a hard ceiling on how human it can ever sound, no amount of pitch/rate
 * tuning changes that, so it's used only as a fallback if the real call
 * fails (network issue, TTS temporarily unavailable), not as the primary
 * path. `apps/api/src/voice/speech/elevenlabs.tts.ts` already existed,
 * already tuned for natural delivery, but was never actually called from
 * anywhere in the app — this is the connection that was missing.
 */
export default function HyrteInterview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [messages, setMessages] = useState<HyrteInterviewTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [voiceState, setVoiceState] = useState<'idle' | 'speaking' | 'listening'>('idle');
  const [voiceMode, setVoiceMode] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [muted, setMuted] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceStateRef = useRef(voiceState);
  const micOnRef = useRef(micOn);
  const sendingRef = useRef(sending);
  const sendRef = useRef<(text: string) => void>(() => {});
  const doneRef = useRef(done);

  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);
  useEffect(() => { micOnRef.current = micOn; }, [micOn]);
  useEffect(() => { sendingRef.current = sending; }, [sending]);
  useEffect(() => { doneRef.current = done; }, [done]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Monotonically-increasing token — lets an in-flight speak() call detect it's been superseded and bail out instead of also starting playback. */
  const speakTokenRef = useRef(0);

  /**
   * Stops whatever might currently be producing or capturing audio — any
   * previous TTS playback, the browser-TTS fallback, and the mic. Upgrade —
   * called at the START of every speak() (not just relied on the reactive
   * voiceState→mic-guard effect, which only runs on the NEXT render/commit)
   * so there's no window where old audio is still playing, or the mic is
   * still listening, while new audio starts. That window is exactly what
   * produced live: the mic caught the interviewer's own TTS output
   * ("You chose to redesign..." transcribed back as "you choose to read")
   * and, separately, overlapping playback read as literal audio "echo".
   */
  const stopAllAudio = useCallback(() => {
    if (audioRef.current) {
      try { audioRef.current.pause(); audioRef.current.currentTime = 0; } catch {}
      audioRef.current = null;
    }
    try { window.speechSynthesis?.cancel(); } catch {}
    try { recognitionRef.current?.stop?.(); } catch {}
    recognitionRef.current = null;
  }, []);

  /** Last-resort fallback only — robotic by nature, never the intended path. */
  const speakBrowser = useCallback((clean: string, token: number) => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!synth) { if (speakTokenRef.current === token) setVoiceState(doneRef.current ? 'idle' : 'listening'); return; }
    const u = new SpeechSynthesisUtterance(clean);
    const voices = synth.getVoices();
    const en = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'));
    const local = en.filter((v) => (v as unknown as { localService?: boolean }).localService !== false);
    const femaleNames = ['samantha', 'karen', 'moira', 'tessa', 'fiona', 'victoria', 'serena', 'zira', 'aria', 'female'];
    const pick = local.find((v) => femaleNames.some((n) => v.name.toLowerCase().includes(n))) ?? local[0] ?? en[0];
    if (pick) u.voice = pick;
    u.rate = 1.0;
    u.pitch = 1.15;
    u.onend = () => { if (speakTokenRef.current === token) setVoiceState(doneRef.current ? 'idle' : 'listening'); };
    u.onerror = () => { if (speakTokenRef.current === token) setVoiceState(doneRef.current ? 'idle' : 'listening'); };
    // A superseding speak() call already cancelled us via stopAllAudio(); don't (re-)speak if we lost the race.
    if (speakTokenRef.current !== token) return;
    try { synth.resume(); } catch {}
    synth.cancel();
    setTimeout(() => {
      if (speakTokenRef.current !== token) return;
      try { synth.speak(u); } catch { if (speakTokenRef.current === token) setVoiceState(doneRef.current ? 'idle' : 'listening'); }
    }, 60);
  }, []);

  const speak = useCallback(async (text: string) => {
    // Cancel anything already speaking/listening BEFORE deciding whether to
    // speak at all, and mint a token so a slower, now-superseded call can
    // tell it lost the race and must not also start playback.
    stopAllAudio();
    const token = ++speakTokenRef.current;
    if (!voiceMode || muted) { setVoiceState(doneRef.current ? 'idle' : 'listening'); return; }
    setVoiceState('speaking');
    const clean = text.replace(/[#*`_>]/g, '');
    try {
      const authToken = useAuthStore.getState().accessToken;
      const res = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ text: clean }),
      });
      if (speakTokenRef.current !== token) return; // superseded while the network call was in flight
      if (!res.ok) throw new Error(`tts ${res.status}`);
      const blob = await res.blob();
      if (speakTokenRef.current !== token) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); if (speakTokenRef.current === token) setVoiceState(doneRef.current ? 'idle' : 'listening'); };
      audio.onerror = () => { URL.revokeObjectURL(url); if (speakTokenRef.current === token) speakBrowser(clean, token); };
      await audio.play();
    } catch {
      if (speakTokenRef.current === token) speakBrowser(clean, token);
    }
  }, [voiceMode, muted, speakBrowser, stopAllAudio]);

  const startListening = useCallback(() => {
    const Ctor = (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition;
    if (!Ctor || !micOnRef.current) return;
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
      const text = (finalChunk + interim).trim();
      setDraft(text);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        if (text && !sendingRef.current && voiceStateRef.current === 'listening') {
          sendRef.current(text);
          finalChunk = '';
        }
      }, 1000);
    };
    rec.onerror = () => {};
    recognitionRef.current = rec;
    try { rec.start(); } catch {}
  }, []);

  // Mic runs only on the candidate's turn, never while the interviewer speaks
  // (otherwise it hears itself through the speakers and cuts itself off).
  useEffect(() => {
    if (!voiceMode || done) return;
    if (voiceState === 'listening' && micOn) startListening();
    else {
      const r = recognitionRef.current;
      recognitionRef.current = null;
      try { r?.stop?.(); } catch {}
    }
  }, [voiceState, micOn, voiceMode, done, startListening]);

  const initStartedRef = useRef(false);
  useEffect(() => {
    // Guards against React calling this effect twice for the same mount
    // (Strict Mode in dev, or a fast remount) — /interview/start isn't
    // idempotent, so a double-fire would ask the backend for two different
    // opening questions and speak() both, which reads as literal "echo,
    // repeating at the same time".
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    (async () => {
      const existing = await api.get<TranscriptResponse>(`/hyrte/sessions/${id}/interview`);
      if (existing.transcript.length > 0) {
        setMessages(existing.transcript);
        const isDone = existing.phase === 'REPORT' || existing.phase === 'COMPLETED';
        setDone(isDone);
        if (!isDone) setVoiceState('listening');
      } else {
        const started = await api.post<{ question: string; done: boolean }>(`/hyrte/sessions/${id}/interview/start`);
        setMessages([{ role: 'interviewer', content: started.question }]);
        speak(started.question);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || sendingRef.current || doneRef.current) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'candidate', content: text.trim() }]);
    setSending(true);
    setVoiceState('idle');
    try {
      const res = await api.post<{ reply: string; done: boolean }>(`/hyrte/sessions/${id}/interview/turn`, { message: text.trim() });
      setMessages((m) => [...m, { role: 'interviewer', content: res.reply }]);
      if (res.done) {
        setDone(true);
        speak(res.reply);
      } else {
        speak(res.reply);
      }
    } finally {
      setSending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, speak]);

  useEffect(() => { sendRef.current = send; }, [send]);

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title="Reflection Interview"
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      <div className="card flex h-[calc(100vh-9rem)] flex-col">
        {loading ? (
          <p className="text-sm text-black/50 dark:text-white/50">Preparing your interview…</p>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between rounded-lg border border-black/10 px-3 py-2 text-xs dark:border-white/10">
              <span className="flex items-center gap-1.5 text-black/60 dark:text-white/60">
                {voiceState === 'speaking' ? (
                  <><SpeakerIcon width={14} height={14} className="text-brand-500" /> Interviewer is speaking…</>
                ) : voiceState === 'listening' ? (
                  <><MicIcon width={14} height={14} className="animate-pulse text-emerald-500" /> Listening — speak or type</>
                ) : (
                  'Ready'
                )}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setVoiceMode((v) => !v)}
                  className="rounded-lg bg-black/5 px-2 py-1 font-medium dark:bg-white/10"
                >
                  Voice mode: {voiceMode ? 'On' : 'Off'}
                </button>
                {voiceMode && (
                  <>
                    <button onClick={() => setMuted((m) => !m)} className="rounded-lg bg-black/5 px-2 py-1 font-medium dark:bg-white/10">
                      {muted ? 'Unmute' : 'Mute'}
                    </button>
                    <button onClick={() => setMicOn((m) => !m)} className="rounded-lg bg-black/5 px-2 py-1 font-medium dark:bg-white/10">
                      {micOn ? 'Mic on' : 'Mic off'}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto">
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'candidate' ? 'text-right' : ''}>
                  <div
                    className={`inline-block max-w-[75%] rounded-xl px-4 py-2 text-sm ${
                      m.role === 'candidate'
                        ? 'bg-brand-500 text-white'
                        : 'bg-black/5 text-black dark:bg-white/10 dark:text-white'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {done && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
                  Interview complete. <button className="font-medium underline" onClick={() => router.push(`/hyrte/session/${id}/report`)}>View your report →</button>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            {!done && (
              <div className="mt-4 flex gap-2">
                <input
                  className="flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
                  placeholder={voiceMode && micOn ? 'Speak, or type here…' : 'Your answer…'}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send(draft)}
                  disabled={sending}
                />
                <button className="btn-primary" disabled={sending} onClick={() => send(draft)}>
                  {sending ? '…' : 'Send'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardShell>
  );
}
