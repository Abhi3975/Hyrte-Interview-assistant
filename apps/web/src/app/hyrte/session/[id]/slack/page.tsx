'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { useHyrteStore } from '@/store/hyrte';
import { HyrteInboxMessage, HyrteSlackMessage, HyrteStakeholder } from '@/lib/hyrte-types';
import { deriveStakeholderStatus, STATUS_DOT } from '@/lib/hyrte-status';

const CHANNELS = ['#product', '#engineering', '#sales', '#leadership'];

/** Part E2 — "typing indicators (duration ∝ message length)". Bounded so a
 * long reply doesn't hold the UI hostage, floored so short ones still read
 * as a beat, not an instant snap. */
const TYPING_MS_PER_CHAR = 35;
const TYPING_MIN_MS = 500;
const TYPING_MAX_MS = 3000;
/** Fallback clear if a DM never gets a reply, so the indicator can't hang forever. */
const TYPING_FALLBACK_MS = 25_000;

export default function HyrteSlack({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { slackVersion, inboxVersion } = useHyrteStore();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [channel, setChannel] = useState(CHANNELS[0]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  // Real reply-in-flight state, not a fabricated ambient loop: set only
  // right after the candidate messages a DM, cleared once that stakeholder's
  // actual reply is revealed (or after a fallback timeout).
  const [typingFor, setTypingFor] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const seenIdsRef = useRef<Set<string> | null>(null);

  // TEAM rail "click → DM" deep link (Part E2).
  useEffect(() => {
    const dm = searchParams.get('dm');
    if (dm) setChannel(`dm:${dm}`);
  }, [searchParams]);

  useEffect(() => {
    seenIdsRef.current = null;
    setPendingIds(new Set());
    setTypingFor(null);
  }, [channel]);

  const { data: stakeholders } = useQuery({
    queryKey: ['hyrte', 'stakeholders', id],
    queryFn: () => api.get<HyrteStakeholder[]>(`/hyrte/sessions/${id}/stakeholders`),
  });
  // Presence dots "synced with TEAM rail" (Part E2) — same derivation, same data.
  const { data: inbox } = useQuery({
    queryKey: ['hyrte', 'inbox', id, inboxVersion],
    queryFn: () => api.get<HyrteInboxMessage[]>(`/hyrte/sessions/${id}/inbox`),
  });
  const { data: messages } = useQuery({
    queryKey: ['hyrte', 'slack', id, channel, slackVersion],
    queryFn: () => api.get<HyrteSlackMessage[]>(`/hyrte/sessions/${id}/slack?channel=${encodeURIComponent(channel)}`),
  });

  // Hold a freshly-arrived stakeholder reply behind "typing…" for a beat
  // proportional to its real length before revealing it — the message and
  // its content are already server-truth; only the reveal timing is client-side.
  useEffect(() => {
    if (!messages) return;
    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(messages.map((m) => m.id));
      return;
    }
    const newOnes = messages.filter((m) => !seenIdsRef.current!.has(m.id));
    for (const m of newOnes) {
      seenIdsRef.current.add(m.id);
      if (m.fromStakeholder && m.fromStakeholder.id === typingFor) {
        const delay = Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, m.body.length * TYPING_MS_PER_CHAR));
        setPendingIds((prev) => new Set(prev).add(m.id));
        setTimeout(() => {
          setPendingIds((prev) => {
            const next = new Set(prev);
            next.delete(m.id);
            return next;
          });
          setTypingFor((cur) => (cur === m.fromStakeholder!.id ? null : cur));
        }, delay);
      }
    }
  }, [messages, typingFor]);

  const visibleMessages = messages?.filter((m) => !pendingIds.has(m.id));
  const typingStakeholder = stakeholders?.find((s) => s.id === typingFor);

  async function send() {
    if (!draft.trim()) return;
    setSending(true);
    try {
      await api.post(`/hyrte/sessions/${id}/slack`, { channel, body: draft });
      setDraft('');
      if (channel.startsWith('dm:')) {
        const stakeholderId = channel.slice(3);
        setTypingFor(stakeholderId);
        setTimeout(() => setTypingFor((cur) => (cur === stakeholderId ? null : cur)), TYPING_FALLBACK_MS);
      }
      queryClient.invalidateQueries({ queryKey: ['hyrte', 'slack', id, channel] });
      queryClient.invalidateQueries({ queryKey: ['hyrte', 'decision-log', id] });
    } finally {
      setSending(false);
    }
  }

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title="Slack"
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      <div className="grid h-full gap-4 md:grid-cols-[200px_1fr]">
        <div className="card h-fit">
          <div className="mb-2 text-xs font-semibold uppercase text-black/40 dark:text-white/40">Channels</div>
          <nav className="space-y-1">
            {CHANNELS.map((c) => (
              <button
                key={c}
                onClick={() => setChannel(c)}
                className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm ${channel === c ? 'bg-brand-500/15 font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
              >
                {c}
              </button>
            ))}
          </nav>
          <div className="mb-2 mt-4 text-xs font-semibold uppercase text-black/40 dark:text-white/40">Direct messages</div>
          <nav className="space-y-1">
            {stakeholders?.map((s) => {
              const dm = `dm:${s.id}`;
              const status = deriveStakeholderStatus(s, inbox);
              return (
                <button
                  key={s.id}
                  onClick={() => setChannel(dm)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${channel === dm ? 'bg-brand-500/15 font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
                  <span className="truncate">{s.name}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="card flex h-[calc(100vh-9rem)] flex-col">
          <div className="mb-3 font-semibold">{channel}</div>
          <div className="flex-1 space-y-3 overflow-y-auto">
            {visibleMessages?.map((m) => (
              <div key={m.id} className="text-sm">
                <span className="font-medium">{m.fromStakeholder?.name ?? 'You'}</span>{' '}
                <span className="text-xs text-black/40 dark:text-white/40">{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <p className="text-black/80 dark:text-white/80">{m.body}</p>
                {/* Refinements doc §8 — same connected-doc link as the Inbox. */}
                {m.relatedKnowledgeDocId && (
                  <Link
                    href={`/hyrte/session/${id}/knowledge-base?docId=${m.relatedKnowledgeDocId}`}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                  >
                    📄 View referenced document
                  </Link>
                )}
              </div>
            ))}
            {!visibleMessages?.length && <p className="text-sm text-black/50 dark:text-white/50">No messages in {channel} yet.</p>}
            {typingStakeholder && (
              <div className="flex items-center gap-1.5 text-xs text-black/40 dark:text-white/40">
                <span className="flex gap-0.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-black/30 dark:bg-white/30" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-black/30 dark:bg-white/30" style={{ animationDelay: '120ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-black/30 dark:bg-white/30" style={{ animationDelay: '240ms' }} />
                </span>
                {typingStakeholder.name} is typing…
              </div>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              className="flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
              placeholder={`Message ${channel}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
            />
            <button className="btn-primary" disabled={sending} onClick={send}>
              Send
            </button>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
