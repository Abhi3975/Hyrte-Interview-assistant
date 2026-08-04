'use client';

import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { HyrteKnowledgeDoc } from '@/lib/hyrte-types';

export default function HyrteKnowledgeBase({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: docs } = useQuery({
    queryKey: ['hyrte', 'knowledge-base', id],
    queryFn: () => api.get<HyrteKnowledgeDoc[]>(`/hyrte/sessions/${id}/knowledge-base`),
  });

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
      <div className="space-y-2">
        {docs?.map((d) => (
          <div key={d.id} className="card">
            <button className="flex w-full items-center justify-between text-left" onClick={() => setOpenId(openId === d.id ? null : d.id)}>
              <div>
                <div className="font-medium">{d.title}</div>
                <div className="text-xs uppercase text-black/40 dark:text-white/40">{d.category}</div>
              </div>
            </button>
            {openId === d.id && (
              <p className="mt-3 whitespace-pre-wrap border-t border-black/5 pt-3 text-sm text-black/80 dark:border-white/10 dark:text-white/80">
                {d.body}
              </p>
            )}
          </div>
        ))}
        {!docs?.length && <p className="text-sm text-black/50 dark:text-white/50">No documents yet.</p>}
      </div>
    </DashboardShell>
  );
}
