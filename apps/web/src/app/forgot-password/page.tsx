'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function ForgotPassword() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const res = await api.post<{ devCode?: string }>('/auth/forgot-password', { email });
      if (res.devCode) setDevCode(res.devCode);
      setStep('reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset code');
    } finally { setLoading(false); }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      await api.post('/auth/reset-password', { email, code, newPassword });
      setDone(true);
      setTimeout(() => router.push('/login'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally { setLoading(false); }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-8 text-lg font-bold">Interview<span className="text-brand-500">AI</span></Link>
      <h1 className="text-2xl font-bold">Reset your password</h1>

      {done ? (
        <p className="mt-4 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-600">Password updated — redirecting to log in…</p>
      ) : step === 'email' ? (
        <form onSubmit={sendCode} className="mt-6 space-y-4">
          <p className="text-sm text-black/60 dark:text-white/60">Enter your account email and we&apos;ll send a 6-digit reset code.</p>
          <Field label="Email" type="email" value={email} onChange={setEmail} />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button className="btn-primary w-full py-2.5" disabled={loading}>{loading ? 'Sending…' : 'Send reset code'}</button>
        </form>
      ) : (
        <form onSubmit={reset} className="mt-6 space-y-4">
          <p className="text-sm text-black/60 dark:text-white/60">Enter the code sent to <b>{email}</b> and a new password.</p>
          {devCode && (
            <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
              <span>Demo code: <b className="tabular-nums">{devCode}</b></span>
              <button type="button" onClick={() => setCode(devCode)} className="text-xs font-semibold underline">Autofill</button>
            </div>
          )}
          <Field label="Reset code" value={code} onChange={setCode} />
          <Field label="New password" type="password" value={newPassword} onChange={setNewPassword} />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button className="btn-primary w-full py-2.5" disabled={loading}>{loading ? 'Updating…' : 'Set new password'}</button>
          <button type="button" onClick={() => setStep('email')} className="w-full text-center text-xs text-black/50 dark:text-white/50">← Use a different email</button>
        </form>
      )}

      <p className="mt-6 text-sm text-black/60 dark:text-white/60">
        Remembered it? <Link href="/login" className="text-brand-500">Log in</Link>
      </p>
    </main>
  );
}

function Field({ label, type = 'text', value, onChange }: { label: string; type?: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required
        className="mt-1 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15" />
    </label>
  );
}
