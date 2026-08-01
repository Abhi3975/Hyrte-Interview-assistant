'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { HyrteInterviewTurn } from '@/lib/hyrte-types';

interface TranscriptResponse {
  phase: string;
  transcript: HyrteInterviewTurn[];
}

export default function HyrteInterview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [messages, setMessages] = useState<HyrteInterviewTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const existing = await api.get<TranscriptResponse>(`/hyrte/sessions/${id}/interview`);
      if (existing.transcript.length > 0) {
        setMessages(existing.transcript);
        setDone(existing.phase === 'REPORT' || existing.phase === 'COMPLETED');
      } else {
        const started = await api.post<{ question: string; done: boolean }>(`/hyrte/sessions/${id}/interview/start`);
        setMessages([{ role: 'interviewer', content: started.question }]);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!draft.trim() || sending || done) return;
    const text = draft.trim();
    setDraft('');
    setMessages((m) => [...m, { role: 'candidate', content: text }]);
    setSending(true);
    try {
      const res = await api.post<{ reply: string; done: boolean }>(`/hyrte/sessions/${id}/interview/turn`, { message: text });
      setMessages((m) => [...m, { role: 'interviewer', content: res.reply }]);
      if (res.done) setDone(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <DashboardShell
      area="hyrte"
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
                  placeholder="Your answer…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  disabled={sending}
                />
                <button className="btn-primary" disabled={sending} onClick={send}>
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
