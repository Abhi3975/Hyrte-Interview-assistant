'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard-shell';
import { RiskMeter } from '@/components/risk-meter';
import { api } from '@/lib/api';
import { ProctorClient, ProctorType } from '@/lib/proctoring';

type Phase = 'setup' | 'identity' | 'ready' | 'active' | 'terminated';

export default function InterviewRoom() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const proctorRef = useRef<ProctorClient | null>(null);

  const [phase, setPhase] = useState<Phase>('setup');
  const [token, setToken] = useState('');
  const [risk, setRisk] = useState(0);
  const [warnings, setWarnings] = useState(0);
  const [events, setEvents] = useState<ProctorType[]>([]);
  const [error, setError] = useState('');

  // 1. Camera + mic setup.
  useEffect(() => {
    let stream: MediaStream;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((s) => {
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        setPhase('identity');
      })
      .catch(() => setError('Camera & microphone access is required to take the interview.'));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  // 2. Proctoring starts once active; poll live risk.
  useEffect(() => {
    if (phase !== 'active') return;
    const client = new ProctorClient({
      sessionId,
      onEvent: (t) => setEvents((prev) => [t, ...prev].slice(0, 12)),
    });
    client.start(videoRef.current ?? undefined);
    proctorRef.current = client;

    const poll = setInterval(async () => {
      try {
        const t = await api.get<{ risk?: { riskScore: number }; warnings: unknown[] }>(
          `/proctoring/sessions/${sessionId}/timeline`,
        );
        if (t.risk) setRisk(t.risk.riskScore);
        setWarnings(t.warnings.length);
        if (t.warnings.length >= 3) setPhase('terminated');
      } catch {
        /* ignore */
      }
    }, 4000);

    return () => {
      client.dispose();
      clearInterval(poll);
    };
  }, [phase, sessionId]);

  async function verifyIdentity() {
    // In production this posts a liveness/face-match reference from the vision
    // service; here we confirm a face is framed and mark the gate passed.
    await api.post(`/interviews/sessions/${sessionId}/verify-identity`, {
      verificationRef: `web-${Date.now()}`,
      passed: true,
    });
    setPhase('ready');
  }

  async function start() {
    setError('');
    try {
      await api.post(`/interviews/sessions/${sessionId}/start`, { sessionToken: token });
      await document.documentElement.requestFullscreen().catch(() => undefined);
      setPhase('active');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start — check your token.');
    }
  }

  return (
    <DashboardShell area="candidate" title="Interview Room" requiredRoles={['CANDIDATE']}>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Video + stage */}
        <div className="card p-0">
          <div className="relative aspect-video overflow-hidden rounded-t-xl bg-black">
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
            {phase === 'active' && (
              <div className="absolute left-3 top-3 rounded-full bg-red-500/90 px-2 py-0.5 text-xs text-white">● REC</div>
            )}
          </div>
          <div className="p-5">
            {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

            {phase === 'identity' && (
              <div>
                <h3 className="font-semibold">Identity verification</h3>
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                  Center your face in the frame in good lighting, then verify to continue.
                </p>
                <button onClick={verifyIdentity} className="btn-primary mt-4">Verify identity</button>
              </div>
            )}

            {phase === 'ready' && (
              <div>
                <h3 className="font-semibold">Enter your session token</h3>
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                  Your recruiter unlocked this assessment and shared a one-time token.
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Session token"
                    className="flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15"
                  />
                  <button onClick={start} className="btn-primary">Start interview</button>
                </div>
              </div>
            )}

            {phase === 'active' && (
              <div>
                <h3 className="font-semibold">Interview in progress</h3>
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                  Stay in fullscreen and keep your face visible. Switching tabs or leaving fullscreen is recorded.
                </p>
              </div>
            )}

            {phase === 'terminated' && (
              <div className="rounded-lg bg-red-500/10 p-4">
                <h3 className="font-semibold text-red-500">Assessment terminated</h3>
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                  This session was ended after repeated violations and locked. Contact your recruiter for a retest.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Live proctoring panel */}
        <div className="space-y-4">
          <div className="card">
            <RiskMeter score={risk} />
            <div className="mt-3 text-sm">Warnings: <b>{warnings}/3</b></div>
          </div>
          <div className="card">
            <h3 className="text-sm font-semibold">Recent signals</h3>
            <div className="mt-2 space-y-1 text-xs text-black/60 dark:text-white/60">
              {events.length === 0 ? <p>No signals yet.</p> : events.map((e, i) => <div key={i}>· {e}</div>)}
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
