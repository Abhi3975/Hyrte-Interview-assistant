'use client';

import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { useHyrteStore } from '@/store/hyrte';
import { HyrteInboxMessage } from '@/lib/hyrte-types';

export default function HyrteInbox({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { inboxVersion } = useHyrteStore();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const { data: inbox } = useQuery({
    queryKey: ['hyrte', 'inbox', id, inboxVersion],
    queryFn: () => api.get<HyrteInboxMessage[]>(`/hyrte/sessions/${id}/inbox`),
  });

  async function sendReply(messageId: string) {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/hyrte/sessions/${id}/inbox/${messageId}/reply`, { body: reply });
      setReply('');
      setOpenId(null);
      queryClient.invalidateQueries({ queryKey: ['hyrte', 'inbox', id] });
      queryClient.invalidateQueries({ queryKey: ['hyrte', 'decision-log', id] });
    } finally {
      setSending(false);
    }
  }

  return (
    <DashboardShell
      area="hyrte"
      title="Inbox"
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      <div className="space-y-3">
        {inbox?.map((m) => (
          <div key={m.id} className="card">
            <button className="flex w-full items-start justify-between text-left" onClick={() => setOpenId(openId === m.id ? null : m.id)}>
              <div>
                <div className="flex items-center gap-2">
                  {!m.readAt && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                  {m.urgent && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-600">Urgent</span>}
                  <span className="font-medium">{m.subject}</span>
                </div>
                <div className="mt-0.5 text-xs text-black/50 dark:text-white/50">
                  from {m.fromStakeholder?.name ?? 'Unknown'} · {m.fromStakeholder?.role}
                </div>
              </div>
              <span className="text-xs text-black/40 dark:text-white/40">{new Date(m.createdAt).toLocaleString()}</span>
            </button>

            {openId === m.id && (
              <div className="mt-4 border-t border-black/5 pt-4 dark:border-white/10">
                <p className="whitespace-pre-wrap text-sm text-black/80 dark:text-white/80">{m.body}</p>
                <textarea
                  className="mt-3 w-full rounded-lg border border-black/10 bg-transparent p-2 text-sm dark:border-white/10"
                  rows={3}
                  placeholder="Write your reply…"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
                <button className="btn-primary mt-2" disabled={sending} onClick={() => sendReply(m.id)}>
                  {sending ? 'Sending…' : 'Send reply'}
                </button>
              </div>
            )}
          </div>
        ))}
        {!inbox?.length && <p className="text-sm text-black/50 dark:text-white/50">No messages yet.</p>}
      </div>
    </DashboardShell>
  );
}
