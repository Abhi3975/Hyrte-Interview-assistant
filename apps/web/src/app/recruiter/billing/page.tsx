'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';
import { CheckIcon } from '@/components/icons';

const PLANS = [
  { plan: 'STARTUP', price: '$49/mo', points: ['Up to 100 interviews/mo', 'AI evaluation', 'Basic proctoring'] },
  { plan: 'GROWTH', price: '$199/mo', points: ['1,000 interviews/mo', 'Voice + video', 'Full proctoring engine'] },
  { plan: 'ENTERPRISE', price: 'Custom', points: ['Unlimited', 'SSO & audit', 'SLA & support'] },
];

function BillingInner() {
  const params = useSearchParams();
  const status = params.get('status');
  const [loading, setLoading] = useState('');

  async function checkout(plan: string) {
    setLoading(plan);
    try {
      const res = await api.post<{ url: string }>('/billing/checkout', { plan, seats: 1 });
      window.location.href = res.url;
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setLoading('');
    }
  }

  return (
    <DashboardShell area="recruiter" title="Billing & Plans" requiredRoles={['ORG_ADMIN']}>
      {status === 'success' && <div className="mb-4 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-600">Subscription active — thank you!</div>}
      {status === 'cancelled' && <div className="mb-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-600">Checkout cancelled.</div>}

      <div className="grid gap-5 md:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.plan} className="card flex flex-col">
            <h3 className="font-semibold">{p.plan}</h3>
            <div className="mt-1 text-2xl font-bold">{p.price}</div>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-black/60 dark:text-white/60">
              {p.points.map((pt) => (
                <li key={pt} className="flex items-center gap-2">
                  <CheckIcon width={14} height={14} className="shrink-0 text-brand-500" />
                  {pt}
                </li>
              ))}
            </ul>
            <button onClick={() => checkout(p.plan)} disabled={!!loading} className="btn-primary mt-4">
              {loading === p.plan ? 'Redirecting…' : 'Choose plan'}
            </button>
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingInner />
    </Suspense>
  );
}
