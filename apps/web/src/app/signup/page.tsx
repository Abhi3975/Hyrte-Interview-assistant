'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore, AuthUser, Role } from '@/store/auth';
import { ShieldIcon, MicIcon, CheckIcon } from '@/components/icons';

interface AuthResponse { user: AuthUser; accessToken: string; refreshToken: string }

function SignupInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '';
  const roleLabel = params.get('role') || 'Software Engineer';
  const setSession = useAuthStore((s) => s.setSession);

  const [mode, setMode] = useState<'otp' | 'recruiter'>('otp');
  // OTP state
  const [form, setForm] = useState({ fullName: '', email: '', phone: '' });
  const [step, setStep] = useState<'details' | 'code'>('details');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  // recruiter state
  const [rec, setRec] = useState({ fullName: '', email: '', password: '', organizationName: '' });

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function land(user: AuthUser) {
    if (next) router.push(next);
    else router.push(user.role === 'CANDIDATE' ? '/candidate' : '/recruiter');
  }

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const res = await api.post<{ sent: boolean; devCode?: string }>('/auth/request-otp', form);
      if (res.devCode) setDevCode(res.devCode);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send code');
    } finally { setLoading(false); }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const res = await api.post<AuthResponse>('/auth/verify-otp', { email: form.email, code });
      setSession(res.user, res.accessToken, res.refreshToken);
      land(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally { setLoading(false); }
  }

  async function recruiterSignup(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const res = await api.post<AuthResponse>('/auth/register', { ...rec, role: 'RECRUITER' as Role });
      setSession(res.user, res.accessToken, res.refreshToken);
      land(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-white">
      <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
        {/* Interview context panel */}
        <div className="rounded-2xl bg-white/5 p-6">
          <div className="text-lg font-bold">Interview<span className="text-brand-500">AI</span></div>
          <div className="mt-1 text-sm text-white/60">{roleLabel} · Demo Interview</div>

          <div className="mt-6 text-xs font-semibold uppercase tracking-wide text-white/40">Interview Team</div>
          <div className="mt-2 space-y-2">
            <div className="rounded-xl bg-white/5 p-3">
              <div className="flex items-center gap-3">
                <Avatar name="P" tone="brand" shield />
                <div>
                  <div className="font-semibold">Proctor</div>
                  <div className="text-xs text-white/60">InterviewAI Integrity</div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-amber-400">
                <ShieldIcon width={12} height={12} /> Reviews your complete interview recording
              </div>
            </div>
            <div className="rounded-xl bg-white/5 p-3">
              <div className="flex items-center gap-3">
                <Avatar name="AI" tone="emerald" icon />
                <div>
                  <div className="font-semibold">AI Interviewer</div>
                  <div className="text-xs text-white/60">InterviewAI</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 text-xs font-semibold uppercase tracking-wide text-white/40">Interview Details</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Detail label="Time" value="20 mins" />
            <Detail label="Questions" value="5" />
          </div>
        </div>

        {/* Signup form */}
        <div className="rounded-2xl bg-white p-6 text-neutral-900">
          <h1 className="text-2xl font-bold">
            {mode === 'recruiter' ? 'Create recruiter account' : 'Sign Up to Start the Interview'}
          </h1>

          {mode === 'otp' ? (
            step === 'details' ? (
              <form onSubmit={sendOtp} className="mt-6 space-y-4">
                <LField label="Full Name" required value={form.fullName} placeholder="What should we call you?" onChange={(v) => setForm({ ...form, fullName: v })} />
                <LField label="Email" required type="email" value={form.email} placeholder="name@example.com" onChange={(v) => setForm({ ...form, email: v })} />
                <LField label="Phone Number" value={form.phone} placeholder="+91 Enter your phone number" onChange={(v) => setForm({ ...form, phone: v })} />
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700" disabled={loading}>
                  {loading ? 'Sending…' : 'Send OTP'}
                </button>
                <p className="text-center text-xs text-neutral-500">By continuing you agree to our Terms &amp; Conditions</p>
              </form>
            ) : (
              <form onSubmit={verifyOtp} className="mt-6 space-y-4">
                <p className="text-sm text-neutral-600">Enter the 6-digit code we sent to <b>{form.email}</b>.</p>
                {devCode && (
                  <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    <span>Demo code: <b className="tabular-nums">{devCode}</b></span>
                    <button type="button" onClick={() => setCode(devCode)} className="text-xs font-semibold underline">Autofill</button>
                  </div>
                )}
                <LField label="OTP Code" required value={code} placeholder="______" onChange={setCode} />
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700" disabled={loading}>
                  {loading ? 'Verifying…' : 'Verify & Start'}
                </button>
                <button type="button" onClick={() => { setStep('details'); setError(''); }} className="w-full text-center text-xs text-neutral-500">← Change details</button>
              </form>
            )
          ) : (
            <form onSubmit={recruiterSignup} className="mt-6 space-y-4">
              <LField label="Full Name" required value={rec.fullName} onChange={(v) => setRec({ ...rec, fullName: v })} />
              <LField label="Work Email" required type="email" value={rec.email} onChange={(v) => setRec({ ...rec, email: v })} />
              <LField label="Company" required value={rec.organizationName} onChange={(v) => setRec({ ...rec, organizationName: v })} />
              <LField label="Password" required type="password" value={rec.password} onChange={(v) => setRec({ ...rec, password: v })} />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button className="w-full rounded-xl bg-neutral-900 py-3 font-semibold text-white hover:bg-neutral-800" disabled={loading}>
                {loading ? 'Creating…' : 'Create recruiter account'}
              </button>
            </form>
          )}

          <div className="mt-5 flex items-center justify-between text-sm text-neutral-500">
            <button onClick={() => { setMode(mode === 'otp' ? 'recruiter' : 'otp'); setError(''); }} className="text-blue-600">
              {mode === 'otp' ? "I'm hiring (recruiter)" : 'I’m a candidate'}
            </button>
            <Link href="/login" className="text-blue-600">Log in</Link>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-neutral-400">
            <CheckIcon width={12} height={12} /> Passwordless & secure — no password to remember.
          </div>
        </div>
      </div>
    </main>
  );
}

export default function SignupPage() {
  return <Suspense fallback={null}><SignupInner /></Suspense>;
}

function Avatar({ name, tone, icon, shield }: { name: string; tone: 'brand' | 'emerald'; icon?: boolean; shield?: boolean }) {
  const bg = tone === 'brand' ? 'bg-brand-500/20 text-brand-300' : 'bg-emerald-500/20 text-emerald-300';
  return (
    <div className={`flex h-10 w-10 items-center justify-center rounded-full ${bg} font-semibold`}>
      {shield ? <ShieldIcon width={18} height={18} /> : icon ? <MicIcon width={18} height={18} /> : name[0]}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-3">
      <div className="text-[10px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  );
}

function LField({ label, type = 'text', value, onChange, placeholder, required }: {
  label: string; type?: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-neutral-700">{label}{required && <span className="text-red-500"> *</span>}</span>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required}
        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none focus:border-blue-500"
      />
    </label>
  );
}
