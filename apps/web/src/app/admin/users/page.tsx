'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';

interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  lastLoginAt?: string;
}

export default function AdminUsers() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const { data } = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () => api.get<AdminUser[]>(`/admin/users?search=${encodeURIComponent(search)}`),
  });

  async function toggle(u: AdminUser) {
    const status = u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    await api.patch(`/admin/users/${u.id}/status`, { status });
    qc.invalidateQueries({ queryKey: ['admin-users'] });
  }

  return (
    <DashboardShell area="admin" title="User Management" requiredRoles={['SUPER_ADMIN']}>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or email…"
        className="mb-4 w-full max-w-sm rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15"
      />
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-black/5 text-left text-black/50 dark:border-white/10 dark:text-white/50">
            <tr>
              <Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {data?.map((u) => (
              <tr key={u.id} className="border-b border-black/5 dark:border-white/5">
                <Td>{u.fullName}</Td>
                <Td>{u.email}</Td>
                <Td>{u.role}</Td>
                <Td>
                  <span className={u.status === 'ACTIVE' ? 'text-emerald-500' : 'text-red-500'}>{u.status}</span>
                </Td>
                <Td>
                  <button onClick={() => toggle(u)} className="btn-ghost text-xs">
                    {u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => <th className="px-4 py-2 font-medium">{children}</th>;
const Td = ({ children }: { children: React.ReactNode }) => <td className="px-4 py-2">{children}</td>;
