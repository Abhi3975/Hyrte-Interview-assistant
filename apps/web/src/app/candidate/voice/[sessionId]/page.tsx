'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard-shell';
import { useAuthStore } from '@/store/auth';
import { VoiceClient } from '@/lib/voice';
import { MicIcon, SpeakerIcon } from '@/components/icons';

type VoiceState = 'idle' | 'connecting' | 'ready' | 'listening' | 'speaking' | 'ended' | 'error';

interface Turn {
  role: 'interviewer' | 'candidate';
  text: string;
}

export default function VoiceInterview() {
  useParams<{ sessionId: string }>(); // session context (used for recording upload in prod)
  const accessToken = useAuthStore((s) => s.accessToken);
  const clientRef = useRef<VoiceClient | null>(null);

  const [state, setState] = useState<VoiceState>('idle');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState('');

  useEffect(() => () => clientRef.current?.stop(), []);

  function begin() {
    if (!accessToken) return;
    setTurns([]);
    setError('');
    const client = new VoiceClient(accessToken, {
      onStateChange: setState,
      onError: setError,
      onPartial: setPartial,
      onInterviewer: (text) => {
        setPartial('');
        setTurns((t) => [...t, { role: 'interviewer', text }]);
      },
    });
    clientRef.current = client;
    client.connect({ jobRole: 'Backend Engineer', category: 'Backend', language: 'English' });
  }

  // When a candidate partial finalizes into a sent turn, reflect it.
  function submitTurn() {
    if (partial.trim()) {
      setTurns((t) => [...t, { role: 'candidate', text: partial.trim() }]);
      setPartial('');
    }
    clientRef.current?.finishTurn();
  }

  return (
    <DashboardShell area="candidate" title="AI Voice Interview" requiredRoles={['CANDIDATE']}>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="card min-h-[420px]">
          {turns.length === 0 && state === 'idle' ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <MicIcon width={40} height={40} className="text-brand-500" />
              <h3 className="mt-3 font-semibold">Ready for your voice interview?</h3>
              <p className="mt-1 max-w-sm text-sm text-black/60 dark:text-white/60">
                The AI interviewer will greet you, then ask adaptive questions with follow-ups. Speak
                naturally; click “Done speaking” when you finish each answer.
              </p>
              <button onClick={begin} className="btn-primary mt-5">Start interview</button>
            </div>
          ) : (
            <div className="space-y-3">
              {turns.map((t, i) => (
                <div key={i} className={`flex ${t.role === 'interviewer' ? 'justify-start' : 'justify-end'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                      t.role === 'interviewer'
                        ? 'bg-black/5 dark:bg-white/5'
                        : 'bg-brand-500 text-white'
                    }`}
                  >
                    {t.text}
                  </div>
                </div>
              ))}
              {partial && (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl bg-brand-500/40 px-4 py-2 text-sm text-white">{partial}…</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card">
            <div className="text-sm font-medium">Status</div>
            <div className="mt-1 text-lg font-semibold capitalize">{stateLabel(state)}</div>
            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
          </div>
          {(state === 'listening' || state === 'speaking') && (
            <button onClick={submitTurn} disabled={state !== 'listening'} className="btn-primary w-full">
              Done speaking
            </button>
          )}
          <div className="card text-xs text-black/60 dark:text-white/60">
            Uses your browser’s speech recognition + synthesis. Production streams audio to
            Deepgram/ElevenLabs via the voice gateway for higher quality and more languages.
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

function stateLabel(s: VoiceState) {
  const withIcon = (icon: ReactNode, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      {label}
    </span>
  );
  return {
    idle: 'Not started',
    connecting: 'Connecting…',
    ready: 'Ready',
    listening: withIcon(<MicIcon width={18} height={18} />, 'Listening'),
    speaking: withIcon(<SpeakerIcon width={18} height={18} />, 'Interviewer speaking'),
    ended: 'Interview complete',
    error: 'Error',
  }[s];
}
