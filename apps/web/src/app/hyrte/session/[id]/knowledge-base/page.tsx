'use client';

import { use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { useHyrteNav } from '@/lib/hyrte-nav';
import { ActivityCenter } from '@/components/hyrte/activity-center';
import { api } from '@/lib/api';
import { HyrteKnowledgeDoc, HyrteSession } from '@/lib/hyrte-types';

/**
 * Refinements doc §8 — "Knowledge Base should be objective-specific. Don't give
 * users a giant wiki. Instead: Company / Product / Customers / Engineering…"
 *
 * The doc's own grouping, mapped from the categories the generator actually
 * produces. Grouping is presentation, so it lives here rather than in the API —
 * the documents and their categories are unchanged.
 */
const AREAS: { key: string; label: string; blurb: string; categories: string[] }[] = [
  { key: 'company', label: 'Company', blurb: 'How the business works and where it stands', categories: ['wiki', 'financial_report'] },
  { key: 'product', label: 'Product', blurb: 'What is being built, and what is queued', categories: ['prd', 'roadmap', 'backlog'] },
  { key: 'customers', label: 'Customers', blurb: 'Who buys it and what they are saying', categories: ['customer_history', 'sales_deck'] },
  { key: 'people', label: 'People & process', blurb: 'How the team operates', categories: ['hr_policy'] },
  { key: 'decisions', label: 'Decisions & meetings', blurb: 'What has already been agreed', categories: ['meeting_notes'] },
];
const AREA_FOR_CATEGORY = new Map(AREAS.flatMap((a) => a.categories.map((c) => [c, a.key])));

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
      <button className="flex w-full items-center justify-between gap-3 text-left" onClick={onToggle}>
        <div className="min-w-0">
          <div className="font-medium">{doc.title}</div>
          <div className="text-xs uppercase text-black/40 dark:text-white/40">{CATEGORY_LABELS[doc.category] ?? doc.category}</div>
        </div>
        {/* §9 — the KB visibly grows from what actually happened, so a document
            that arrived from a meeting says so. */}
        {doc.sourceEventId && (
          <span className="shrink-0 rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-medium text-brand-600 dark:text-brand-400">
            from a meeting
          </span>
        )}
      </button>
      {/* How they got to it — real evidence of investigation, worth showing back. */}
      {doc.unlockedBy && <div className="mt-1 text-[11px] text-black/40 dark:text-white/40">Uncovered by: {doc.unlockedBy}</div>}
      {open && (
        <p className="mt-3 whitespace-pre-wrap border-t border-black/5 pt-3 text-sm text-black/80 dark:border-white/10 dark:text-white/80">
          {doc.body}
        </p>
      )}
    </div>
  );
}

/**
 * §8 — "Everything else stays hidden until discovered." A locked document is
 * deliberately NOT invisible: the candidate can see it exists and roughly
 * where it lives, so choosing whether to go after it is a real decision about
 * where to spend limited time. Its body is redacted server-side, not hidden
 * here — sending the text and styling it away would put the whole point one
 * devtools tab away.
 */
function LockedDocCard({ doc }: { doc: HyrteKnowledgeDoc }) {
  return (
    <div className="card border-dashed opacity-80">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-black/60 dark:text-white/60">{doc.title}</div>
          <div className="text-xs uppercase text-black/35 dark:text-white/35">{CATEGORY_LABELS[doc.category] ?? doc.category}</div>
        </div>
        <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-medium text-black/45 dark:bg-white/10 dark:text-white/45">
          not disclosed yet
        </span>
      </div>
      {doc.unlockHint && <p className="mt-2 text-xs text-black/55 dark:text-white/55">{doc.unlockHint}</p>}
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
  // Live unread badges on the sidebar surfaces (Refinements doc §4).
  const nav = useHyrteNav(id);
  const searchParams = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // §8 — "Knowledge Base — Product Launch": the KB is scoped to what the
  // candidate is actually here to do, so it names the objective.
  const { data: session } = useQuery({
    queryKey: ['hyrte', 'session', id],
    queryFn: () => api.get<HyrteSession>(`/hyrte/sessions/${id}`),
  });
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

  const available = docs?.filter((d) => !d.locked) ?? [];
  const locked = docs?.filter((d) => d.locked) ?? [];

  // §9 — "Knowledge Base automatically updates." Anything created after the
  // candidate entered the workspace arrived DURING the session: a meeting they
  // sat in wrote it, or investigating surfaced it. Worth saying so, because a
  // knowledge base that silently grows is indistinguishable from one that does
  // not.
  const unlockedAt = session?.workspaceUnlockedAt ? new Date(session.workspaceUnlockedAt).getTime() : null;
  const arrivedDuringSession = unlockedAt
    ? available.filter((d) => (d.createdAt ? new Date(d.createdAt).getTime() > unlockedAt + 5_000 : false) || !!d.unlockedBy)
    : [];

  const grouped = AREAS.map((area) => ({
    ...area,
    docs: available.filter((d) => AREA_FOR_CATEGORY.get(d.category.toLowerCase()) === area.key),
  })).filter((a) => a.docs.length > 0);
  const ungrouped = available.filter((d) => !AREA_FOR_CATEGORY.has(d.category.toLowerCase()));

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title="Knowledge Base"
      requiredRoles={['CANDIDATE']}
      navOverride={nav}
      headerExtra={<ActivityCenter sessionId={id} />}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      {session?.missionBrief?.objective && (
        <div className="mb-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">What you are here to do</div>
          <p className="mt-0.5 text-sm text-black/70 dark:text-white/70">{session.missionBrief.objective}</p>
        </div>
      )}

      <input
        className="mb-4 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
        placeholder="Search documents…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {/* §9 — what has arrived since they started working. */}
      {!query && arrivedDuringSession.length > 0 && (
        <div className="mb-5 rounded-lg border border-brand-500/30 bg-brand-500/[0.06] p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
            {arrivedDuringSession.length} {arrivedDuringSession.length === 1 ? 'document has' : 'documents have'} arrived since you started
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {arrivedDuringSession.slice(0, 4).map((d) => (
              <li key={d.id} className="text-sm text-black/70 dark:text-white/70">
                {d.title}
                <span className="text-black/40 dark:text-white/40">
                  {d.sourceEventId ? ' · written up after a meeting' : d.unlockedBy ? ` · ${d.unlockedBy.toLowerCase()}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {query ? (
        <div className="space-y-2">
          {available.map((d) => (
            <DocCard key={d.id} doc={d} open={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((area) => (
            <div key={area.key}>
              <div className="mb-0.5 flex items-baseline gap-2">
                <h3 className="text-sm font-semibold">{area.label}</h3>
                <span className="text-xs text-black/40 dark:text-white/40">
                  {area.docs.length} {area.docs.length === 1 ? 'doc' : 'docs'}
                </span>
              </div>
              <p className="mb-2 text-xs text-black/45 dark:text-white/45">{area.blurb}</p>
              <div className="space-y-2">
                {area.docs.map((d) => (
                  <DocCard key={d.id} doc={d} open={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} />
                ))}
              </div>
            </div>
          ))}
          {ungrouped.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Everything else</h3>
              <div className="space-y-2">
                {ungrouped.map((d) => (
                  <DocCard key={d.id} doc={d} open={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {locked.length > 0 && (
        <div className="mt-6">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
            Not disclosed yet · {locked.length}
          </div>
          <p className="mb-2 text-xs text-black/45 dark:text-white/45">
            These exist, but nobody has handed them to you. Go and find them.
          </p>
          <div className="space-y-2">
            {locked.map((d) => (
              <LockedDocCard key={d.id} doc={d} />
            ))}
          </div>
        </div>
      )}

      {docs?.length === 0 && (
        <p className="text-sm text-black/50 dark:text-white/50">
          {query ? `No documents match "${query}".` : 'No documents yet.'}
        </p>
      )}
    </DashboardShell>
  );
}
