'use client';

import { use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { HyrteKnowledgeDoc } from '@/lib/hyrte-types';

const CATEGORY_LABELS: Record<string, string> = {
  prd: 'PRD',
  roadmap: 'Roadmap',
  wiki: 'Wiki',
  backlog: 'Backlog',
  hr_policy: 'HR Policy',
  sales_deck: 'Sales Deck',
  financial_report: 'Financial Report',
  customer_history: 'Customer History',
  meeting_notes: 'Meeting Notes',
  general: 'General',
};

function DocCard({ doc, open, onToggle }: { doc: HyrteKnowledgeDoc; open: boolean; onToggle: () => void }) {
  return (
    <div className="card">
      <button className="flex w-full items-center justify-between text-left" onClick={onToggle}>
        <div>
          <div className="font-medium">{doc.title}</div>
          <div className="text-xs uppercase text-black/40 dark:text-white/40">{CATEGORY_LABELS[doc.category] ?? doc.category}</div>
        </div>
      </button>
      {open && (
        <p className="mt-3 whitespace-pre-wrap border-t border-black/5 pt-3 text-sm text-black/80 dark:border-white/10 dark:text-white/80">
          {doc.body}
        </p>
      )}
    </div>
  );
}

/**
 * Refinements doc §8 — "Every document is searchable" (real server-side
 * search, not a client array filter) and "Role-Specific Knowledge Bases...
 * adapts to every simulation and role" (docs relevant to the candidate's own
 * role surface first — nothing is ever hidden, per §13's Hidden Information
 * System). Also supports being deep-linked from an inbox/Slack message that
 * references a specific doc (`?docId=`, refinements doc §8's "clicking it
 * should open the Knowledge Base → Product Roadmap").
 */
export default function HyrteKnowledgeBase({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: docs } = useQuery({
    queryKey: ['hyrte', 'knowledge-base', id, debouncedQuery],
    queryFn: () => api.get<HyrteKnowledgeDoc[]>(`/hyrte/sessions/${id}/knowledge-base${debouncedQuery ? `?q=${encodeURIComponent(debouncedQuery)}` : ''}`),
  });

  // Deep link from an inbox/Slack message's "View in Knowledge Base" link —
  // open that specific doc once it loads, one time only.
  useEffect(() => {
    const docId = searchParams.get('docId');
    if (docId && docs?.some((d) => d.id === docId)) setOpenId(docId);
  }, [searchParams, docs]);

  const relevant = docs?.filter((d) => d.relevantToYourRole) ?? [];
  const other = docs?.filter((d) => !d.relevantToYourRole) ?? [];

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title="Knowledge Base"
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      <input
        className="mb-4 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
        placeholder="Search documents…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {!query && relevant.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">Relevant to your role</div>
          <div className="space-y-2">
            {relevant.map((d) => (
              <DocCard key={d.id} doc={d} open={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} />
            ))}
          </div>
        </div>
      )}

      <div>
        {!query && other.length > 0 && (
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">Other documents</div>
        )}
        <div className="space-y-2">
          {(query ? docs ?? [] : other).map((d) => (
            <DocCard key={d.id} doc={d} open={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} />
          ))}
        </div>
      </div>

      {docs?.length === 0 && (
        <p className="text-sm text-black/50 dark:text-white/50">
          {query ? `No documents match "${query}".` : 'No documents yet.'}
        </p>
      )}
    </DashboardShell>
  );
}
