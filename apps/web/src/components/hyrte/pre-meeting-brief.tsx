'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PreMeetingBrief } from '@/lib/hyrte-types';

/**
 * Refinements doc §7 — "Team messages should appear BEFORE the meeting.
 * Absolutely. The sequence should be: Incoming context → Messages → Documents
 * → Meeting → Decision → Execution. Not: Meeting → AI explains everything.
 * Because real work doesn't work like that."
 *
 * And §5's worked example of what that looks like:
 *
 *   Engineering — 10:02 AM  "We cannot ship the analytics dashboard this week."
 *   Sales       — 10:08 AM  "Enterprise customer is expecting it Friday."
 *   Marketing   — 10:12 AM  "Campaign already scheduled around the launch."
 *   "Now the candidate enters the meeting knowing what is happening."
 *
 * Before this the candidate went straight from a Join button into a live
 * discussion with no idea what any of it was about — so the meeting had to
 * explain itself, which is exactly the shape the doc says to avoid. This is the
 * context step, drawn from the real inbox/Slack history of the people actually
 * attending, not a generated preamble.
 */
export function PreMeetingBriefCard({
  sessionId,
  eventId,
  onJoin,
  joining,
}: {
  sessionId: string;
  eventId: string;
  onJoin: () => void;
  joining: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['hyrte', 'meeting-brief', sessionId, eventId],
    queryFn: () => api.get<PreMeetingBrief>(`/hyrte/sessions/${sessionId}/calendar/${eventId}/brief`),
  });

  if (isLoading) return <p className="mt-4 text-sm text-black/50 dark:text-white/50">Pulling the context together…</p>;
  if (!data) return null;

  return (
    <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--hos-border, rgba(0,0,0,0.05))' }}>
      {data.agenda && (
        <>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">Agenda</div>
          <p className="mb-4 text-sm text-black/70 dark:text-white/70">{data.agenda}</p>
        </>
      )}

      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">Who will be there</div>
      <div className="mb-4 flex flex-wrap gap-2">
        {data.attendees.map((a) => (
          <span key={a.id} className="rounded-lg border border-black/5 px-2.5 py-1.5 text-xs dark:border-white/10">
            <span className="font-medium">{a.name}</span>
            <span className="text-black/45 dark:text-white/45"> · {a.role}</span>
          </span>
        ))}
        {data.attendees.length === 0 && <span className="text-sm text-black/50 dark:text-white/50">No one else invited.</span>}
      </div>

      {/* §7's "Messages" step — what these specific people have already said. */}
      {data.recentStatements.length > 0 && (
        <>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
            What they&apos;ve already said
          </div>
          <div className="mb-4 space-y-2 rounded-lg border border-black/5 p-3 dark:border-white/10">
            {data.recentStatements.map((s, i) => (
              <div key={i} className="text-sm">
                <span className="font-medium">{s.speaker}</span>
                <span className="ml-2 text-xs text-black/40 dark:text-white/40">
                  {new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <p className="mt-0.5 text-black/75 dark:text-white/75">{s.body}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* §7's "Documents" step. */}
      {data.relatedDocs.length > 0 && (
        <>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">Worth reading first</div>
          <div className="mb-4 flex flex-wrap gap-2">
            {data.relatedDocs.map((d) => (
              <Link
                key={d.id}
                href={`/hyrte/session/${sessionId}/knowledge-base?doc=${d.id}`}
                className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
              >
                {d.title}
                <span className="text-black/35 dark:text-white/35"> · {d.category}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={joining} onClick={onJoin}>
          {joining ? 'Joining…' : data.alreadyStarted ? 'Rejoin the meeting' : 'Join the meeting'}
        </button>
        <span className="text-xs text-black/45 dark:text-white/45">
          They will expect you to have read this. Anything you claim in the room gets checked against it.
        </span>
      </div>
    </div>
  );
}
