'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { HyrteHiringOutcomeEvent, HiringOutcomeEventType, PerformanceRating } from '@/lib/hyrte-types';

/**
 * §9 Learning Engine, write path.
 *
 * The API for this has existed since the schema phase with no way for a
 * recruiter to reach it, which is why the committee had nothing to learn from.
 * This is that way.
 *
 * Only some events carry a performance judgment, so the rating control appears
 * only for those rather than sitting there greyed out — and only hires can be
 * followed up at all, which is a property of the problem worth showing.
 */

const EVENT_LABELS: Record<HiringOutcomeEventType, string> = {
  HIRED: 'Hired',
  REJECTED: 'Rejected',
  WITHDREW: 'Withdrew',
  OFFER_DECLINED: 'Declined the offer',
  RETENTION_CHECKPOINT: 'Performance review',
  PROMOTED: 'Promoted',
  RESIGNED: 'Resigned',
  TERMINATED: 'Let go',
};

/** The events where a performance rating is meaningful (see schema comment). */
const RATED_EVENTS = new Set<HiringOutcomeEventType>(['RETENTION_CHECKPOINT', 'PROMOTED', 'RESIGNED', 'TERMINATED']);

const RATING_LABELS: Record<PerformanceRating, string> = {
  HIGH_PERFORMER: 'High performer',
  MEETS_EXPECTATIONS: 'Meets expectations',
  BELOW_EXPECTATIONS: 'Below expectations',
};

export function HiringOutcomePanel({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const [eventType, setEventType] = useState<HiringOutcomeEventType>('HIRED');
  const [rating, setRating] = useState<PerformanceRating | ''>('');
  const [notes, setNotes] = useState('');

  const eventsQuery = useQuery({
    queryKey: ['hiring-outcome', sessionId],
    queryFn: () => api.get<HyrteHiringOutcomeEvent[]>(`/hyrte/sessions/${sessionId}/hiring-outcome`),
    enabled: Boolean(sessionId),
  });

  const record = useMutation({
    mutationFn: () =>
      api.post<HyrteHiringOutcomeEvent>(`/hyrte/sessions/${sessionId}/hiring-outcome`, {
        eventType,
        ...(RATED_EVENTS.has(eventType) && rating ? { performanceRating: rating } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }),
    onSuccess: () => {
      setNotes('');
      setRating('');
      qc.invalidateQueries({ queryKey: ['hiring-outcome', sessionId] });
      // The committee's weights may have just moved.
      qc.invalidateQueries({ queryKey: ['council-calibration'] });
    },
  });

  const events = eventsQuery.data ?? [];
  const wasHired = events.some((e) => e.eventType === 'HIRED');

  return (
    <div className="card">
      <h3 className="mb-1 text-sm font-semibold text-black/50 dark:text-white/50">What actually happened</h3>
      <p className="mb-3 text-sm text-black/60 dark:text-white/60">
        Recording the real outcome is what lets the committee learn which of its members to trust.
      </p>

      {events.length > 0 && (
        <ol className="mb-4 space-y-1.5 border-l border-black/10 pl-3 dark:border-white/10">
          {events.map((e) => (
            <li key={e.id} className="text-sm">
              <span className="font-medium">{EVENT_LABELS[e.eventType] ?? e.eventType}</span>
              {e.performanceRating && (
                <span className="ml-1.5 text-black/60 dark:text-white/60">
                  &middot; {RATING_LABELS[e.performanceRating]}
                </span>
              )}
              <span className="ml-1.5 text-xs text-black/40 dark:text-white/40">
                {new Date(e.occurredAt).toLocaleDateString()}
              </span>
              {e.notes && <p className="text-xs text-black/60 dark:text-white/60">{e.notes}</p>}
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap gap-2">
        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value as HiringOutcomeEventType)}
          className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
        >
          {(Object.keys(EVENT_LABELS) as HiringOutcomeEventType[]).map((key) => (
            <option key={key} value={key} className="dark:bg-neutral-900">
              {EVENT_LABELS[key]}
            </option>
          ))}
        </select>

        {RATED_EVENTS.has(eventType) && (
          <select
            value={rating}
            onChange={(e) => setRating(e.target.value as PerformanceRating | '')}
            className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
          >
            <option value="" className="dark:bg-neutral-900">
              No rating
            </option>
            {(Object.keys(RATING_LABELS) as PerformanceRating[]).map((key) => (
              <option key={key} value={key} className="dark:bg-neutral-900">
                {RATING_LABELS[key]}
              </option>
            ))}
          </select>
        )}

        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="min-w-[12rem] flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
        />

        <button
          onClick={() => record.mutate()}
          disabled={record.isPending}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {record.isPending ? 'Recording…' : 'Record'}
        </button>
      </div>

      {record.isError && <p className="mt-2 text-sm text-red-600">Could not record that outcome.</p>}

      {RATED_EVENTS.has(eventType) && !wasHired && (
        <p className="mt-2 text-xs text-amber-600">
          No hire recorded for this session yet. Only candidates who were actually hired produce evidence the committee
          can learn from.
        </p>
      )}
    </div>
  );
}
