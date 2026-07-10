'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';

interface Question {
  id: string;
  publicId: string;
  title: string;
  category: string;
  topic: string;
  difficulty: string;
  type: string;
  source: string;
}

const CATEGORIES = ['', 'DSA', 'FRONTEND', 'BACKEND', 'SQL', 'SYSTEM_DESIGN', 'DEVOPS', 'AI_ML', 'DATA_ANALYTICS', 'PRODUCT_MANAGEMENT', 'MBA', 'HR', 'FINANCE'];

export default function QuestionBank() {
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const { data } = useQuery({
    queryKey: ['questions', category, search],
    queryFn: () =>
      api.get<{ items: Question[]; total: number }>(
        `/questions?take=50${category ? `&category=${category}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
  });

  return (
    <DashboardShell area="recruiter" title="Question Bank" requiredRoles={['RECRUITER', 'ORG_ADMIN']}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15">
          {CATEGORIES.map((c) => <option key={c} value={c}>{c || 'All categories'}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
          className="flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15" />
        <span className="text-sm text-black/50 dark:text-white/50">{data?.total ?? 0} results</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-black/5 text-left text-black/50 dark:border-white/10 dark:text-white/50">
            <tr><Th>ID</Th><Th>Title</Th><Th>Category</Th><Th>Difficulty</Th><Th>Source</Th></tr>
          </thead>
          <tbody>
            {data?.items.map((q) => (
              <tr key={q.id} className="border-b border-black/5 dark:border-white/5">
                <Td><span className="font-mono text-xs">{q.publicId}</span></Td>
                <Td>{q.title}</Td>
                <Td>{q.category}</Td>
                <Td>{q.difficulty}</Td>
                <Td><span className="rounded-full border border-black/10 px-2 py-0.5 text-xs dark:border-white/10">{q.source}</span></Td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.items.length && <p className="p-4 text-sm text-black/60 dark:text-white/60">No questions. Generate or aggregate to populate the bank.</p>}
      </div>
    </DashboardShell>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => <th className="px-4 py-2 font-medium">{children}</th>;
const Td = ({ children }: { children: React.ReactNode }) => <td className="px-4 py-2">{children}</td>;
