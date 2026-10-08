'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore, AuthUser } from '@/store/auth';

interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

const COUNTRY_CODES = [
  { code: '+91', country: 'IN', flag: '🇮🇳', label: 'India (+91)' },
  { code: '+1', country: 'US', flag: '🇺🇸', label: 'United States (+1)' },
  { code: '+44', country: 'GB', flag: '🇬🇧', label: 'United Kingdom (+44)' },
  { code: '+61', country: 'AU', flag: '🇦🇺', label: 'Australia (+61)' },
  { code: '+49', country: 'DE', flag: '🇩🇪', label: 'Germany (+49)' },
  { code: '+33', country: 'FR', flag: '🇫🇷', label: 'France (+33)' },
  { code: '+81', country: 'JP', flag: '🇯🇵', label: 'Japan (+81)' },
  { code: '+65', country: 'SG', flag: '🇸🇬', label: 'Singapore (+65)' },
  { code: '+971', country: 'AE', flag: '🇦🇪', label: 'UAE (+971)' },
];

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);

  const nextUrl = searchParams.get('next');

  // Mode: 'PHONE_OTP' | 'EMAIL_PASSWORD'
  const [authMode, setAuthMode] = useState<'PHONE_OTP' | 'EMAIL_PASSWORD'>('PHONE_OTP');
  // OTP Flow Step: 'ENTER_PHONE' | 'VERIFY_OTP' | 'ENTER_NAME'
  const [otpStep, setOtpStep] = useState<'ENTER_PHONE' | 'VERIFY_OTP' | 'ENTER_NAME'>('ENTER_PHONE');

  // Phone state
  const [countryCode, setCountryCode] = useState('+91');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [fullName, setFullName] = useState('');

  // 6-digit OTP input boxes
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Resend Countdown
  const [countdown, setCountdown] = useState(30);
  const [canResend, setCanResend] = useState(false);

  // Email/Password state (for Recruiter secondary login)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // UI status
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [devCodeHint, setDevCodeHint] = useState<string | null>(null);

  // Countdown effect
  useEffect(() => {
    if (otpStep !== 'VERIFY_OTP' || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setCanResend(true);
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [otpStep, countdown]);

  const fullPhone = `${countryCode}${phoneNumber.replace(/\D/g, '')}`;

  function navigatePostLogin(user: AuthUser) {
    if (nextUrl) {
      router.push(nextUrl);
    } else {
      router.push(user.role === 'CANDIDATE' ? '/candidate' : '/recruiter');
    }
  }

  // Request OTP
  async function handleSendOtp(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError('');
    const cleanNum = phoneNumber.replace(/\D/g, '');
    if (cleanNum.length < 7) {
      setError('Please enter a valid phone number');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<{ sent: boolean; devCode?: string }>(`/auth/request-otp`, {
        phone: fullPhone,
        fullName: fullName.trim() || 'Candidate',
      });
      if (res.devCode) setDevCodeHint(res.devCode);
      setOtpStep('VERIFY_OTP');
      setCountdown(30);
      setCanResend(false);
      setOtpDigits(['', '', '', '', '', '']);
      setTimeout(() => otpInputRefs.current[0]?.focus(), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send verification code');
    } finally {
      setLoading(false);
    }
  }

  // Handle Digit Change
  function handleOtpDigitChange(index: number, val: string) {
    const char = val.slice(-1);
    if (!/^\d*$/.test(char)) return;

    const next = [...otpDigits];
    next[index] = char;
    setOtpDigits(next);

    if (char && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when 6th digit filled
    if (next.every((d) => d !== '') && next.join('').length === 6) {
      handleVerifyOtp(next.join(''));
    }
  }

  // Handle Paste
  function handleOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const digits = pasted.split('');
    const next = ['', '', '', '', '', ''];
    digits.forEach((d, i) => {
      if (i < 6) next[i] = d;
    });
    setOtpDigits(next);
    if (next.every((d) => d !== '') && next.join('').length === 6) {
      handleVerifyOtp(next.join(''));
    } else {
      const firstEmpty = next.findIndex((d) => d === '');
      if (firstEmpty !== -1) otpInputRefs.current[firstEmpty]?.focus();
    }
  }

  // Handle Backspace navigation
  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  }

  // Verify OTP
  async function handleVerifyOtp(codeToSubmit?: string) {
    const code = codeToSubmit || otpDigits.join('');
    if (code.length < 6) {
      setError('Please enter all 6 digits');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await api.post<AuthResponse>('/auth/verify-otp', {
        phone: fullPhone,
        code,
      });

      // If user's name is default placeholder or missing, allow prompt step if needed
      if (!res.user.fullName || res.user.fullName === 'Candidate') {
        setSession(res.user, res.accessToken, res.refreshToken);
        setOtpStep('ENTER_NAME');
      } else {
        setSession(res.user, res.accessToken, res.refreshToken);
        navigatePostLogin(res.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired OTP code');
    } finally {
      setLoading(false);
    }
  }

  // Complete Name Registration (for new unknown number)
  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      setError('Please enter your name');
      return;
    }
    const currentUser = useAuthStore.getState().user;
    if (currentUser) {
      navigatePostLogin(currentUser);
    } else {
      router.push(nextUrl || '/candidate');
    }
  }

  // Google OAuth Login
  function handleGoogleLogin() {
    // Redirect to Google Auth / Session API or demo session
    setLoading(true);
    api
      .post<{ sent: boolean; devCode?: string }>('/auth/request-otp', { phone: '+15550001111', fullName: 'Google User' })
      .then((res) => {
        if (res.devCode) {
          return api.post<AuthResponse>('/auth/verify-otp', { phone: '+15550001111', code: res.devCode });
        }
        throw new Error('Google OAuth popup disabled in demo mode');
      })
      .then((res) => {
        setSession(res.user, res.accessToken, res.refreshToken);
        navigatePostLogin(res.user);
      })
      .catch(() => {
        setError('Google sign-in demo mode active — use Phone OTP below');
      })
      .finally(() => setLoading(false));
  }

  // Secondary Recruiter Login (Email + Password)
  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<AuthResponse>('/auth/login', { email, password });
      setSession(res.user, res.accessToken, res.refreshToken);
      navigatePostLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed — check credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2 bg-slate-950 text-white font-sans">
      {/* LEFT PANEL: Koyo-style Product & Benefits Banner */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12 bg-gradient-to-br from-brand-950 via-slate-950 to-brand-900 border-r border-slate-800">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-sky-500/10 blur-3xl" />

        <div className="relative z-10">
          <Link href="/" className="flex items-center gap-2 text-2xl font-black tracking-tight text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white font-extrabold text-base shadow-lg shadow-brand-500/30">
              H
            </span>
            HYRTE
          </Link>
          <div className="mt-[15vh] space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-400">
              ⚡ Next-Gen Workplace Simulation Platform
            </div>
            <h1 className="text-4xl font-extrabold leading-tight text-slate-100 sm:text-5xl">
              Experience the actual job <br />
              <span className="bg-gradient-to-r from-brand-400 via-sky-300 to-indigo-300 bg-clip-text text-transparent">
                before you get hired.
              </span>
            </h1>
            <p className="max-w-md text-base leading-relaxed text-slate-300">
              HYRTE replaces trivia questions with real-world workplace simulations. Debug production issues, qualify enterprise leads, and collaborate with AI coworkers.
            </p>
          </div>
        </div>

        {/* Feature Highlights */}
        <div className="relative z-10 space-y-4 border-t border-slate-800/80 pt-6">
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 backdrop-blur">
              <div className="font-bold text-white">100% Real Work</div>
              <div className="mt-0.5 text-slate-400">No trivia or checkboxes</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 backdrop-blur">
              <div className="font-bold text-white">Adaptive AI</div>
              <div className="mt-0.5 text-slate-400">Evaluates actual reasoning</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 backdrop-blur">
              <div className="font-bold text-white">Instant Feedback</div>
              <div className="mt-0.5 text-slate-400">Detailed evidence report</div>
            </div>
          </div>
          <div className="text-xs text-slate-500">© 2026 HYRTE Inc. All rights reserved.</div>
        </div>
      </div>

      {/* RIGHT PANEL: Koyo-style Auth Container */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16 bg-slate-950">
        <div className="mx-auto w-full max-w-md space-y-6">
          <div className="lg:hidden mb-4">
            <Link href="/" className="flex items-center gap-2 text-xl font-black tracking-tight text-white">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white font-extrabold text-sm">
                H
              </span>
              HYRTE
            </Link>
          </div>

          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
              {authMode === 'EMAIL_PASSWORD'
                ? 'Recruiter Sign In'
                : otpStep === 'ENTER_PHONE'
                ? 'Sign in to HYRTE'
                : otpStep === 'VERIFY_OTP'
                ? 'Enter Verification Code'
                : 'Welcome to HYRTE'}
            </h2>
            <p className="mt-1.5 text-sm text-slate-400">
              {authMode === 'EMAIL_PASSWORD'
                ? 'Log in with your recruiter email and password'
                : otpStep === 'ENTER_PHONE'
                ? 'Enter your phone number to receive a 6-digit OTP code'
                : otpStep === 'VERIFY_OTP'
                ? `Sent via SMS to ${fullPhone}`
                : 'Please tell us your name to set up your profile'}
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Dev Code Hint */}
          {devCodeHint && otpStep === 'VERIFY_OTP' && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
              <span className="font-semibold">Demo Mode OTP Code:</span> <code className="font-bold text-sm tracking-widest">{devCodeHint}</code>
            </div>
          )}

          {/* PRIMARY PATH: Phone OTP */}
          {authMode === 'PHONE_OTP' && (
            <>
              {/* STEP 1: Phone Entry */}
              {otpStep === 'ENTER_PHONE' && (
                <form onSubmit={handleSendOtp} className="space-y-4">
                  <div>
                    <label htmlFor="phone-number" className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                      Phone Number
                    </label>
                    <div className="flex rounded-xl border border-slate-800 bg-slate-900 focus-within:border-brand-500">
                      <select
                        aria-label="Country code"
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                        className="rounded-l-xl bg-transparent border-r border-slate-800 px-3 py-3 text-sm text-slate-200 outline-none cursor-pointer"
                      >
                        {COUNTRY_CODES.map((c) => (
                          <option key={c.code} value={c.code} className="bg-slate-900 text-slate-200">
                            {c.flag} {c.code}
                          </option>
                        ))}
                      </select>
                      <input
                        id="phone-number"
                        type="tel"
                        required
                        autoFocus
                        autoComplete="tel-national"
                        placeholder="99052 70822"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        className="w-full bg-transparent px-4 py-3 text-sm text-white placeholder-slate-500 outline-none"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !phoneNumber.trim()}
                    className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 hover:bg-brand-500 disabled:opacity-50 transition"
                  >
                    {loading ? 'Sending code…' : 'Continue with Phone'}
                  </button>

                  <div className="relative my-6 flex items-center justify-center">
                    <div className="absolute inset-0 border-t border-slate-800" />
                    <span className="relative bg-slate-950 px-3 text-xs uppercase text-slate-500">or</span>
                  </div>

                  {/* Continue with Google */}
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 py-3 text-sm font-medium text-slate-200 hover:bg-slate-800 transition"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24">
                      <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.3 9 5 12 5z" />
                      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z" />
                      <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9z" />
                      <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.3-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z" />
                    </svg>
                    Continue with Google
                  </button>
                </form>
              )}

              {/* STEP 2: 6-Box OTP Input */}
              {otpStep === 'VERIFY_OTP' && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">
                      6-Digit Verification Code
                    </label>
                    <div className="flex gap-2 sm:gap-3 justify-between">
                      {otpDigits.map((digit, idx) => (
                        <input
                          key={idx}
                          ref={(el) => { otpInputRefs.current[idx] = el; }}
                          type="text"
                          inputMode="numeric"
                          maxLength={1}
                          aria-label={`Digit ${idx + 1}`}
                          autoComplete="one-time-code"
                          value={digit}
                          onChange={(e) => handleOtpDigitChange(idx, e.target.value)}
                          onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                          onPaste={handleOtpPaste}
                          className="h-12 w-12 sm:h-14 sm:w-14 rounded-xl border border-slate-800 bg-slate-900 text-center font-mono text-xl font-bold text-white outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                        />
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleVerifyOtp()}
                    disabled={loading || otpDigits.join('').length < 6}
                    className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 hover:bg-brand-500 disabled:opacity-50 transition"
                  >
                    {loading ? 'Verifying…' : 'Verify Code & Sign In'}
                  </button>

                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <button
                      type="button"
                      onClick={() => {
                        setOtpStep('ENTER_PHONE');
                        setError('');
                      }}
                      className="hover:text-white transition"
                    >
                      ← Change phone number
                    </button>
                    {canResend ? (
                      <button type="button" onClick={() => handleSendOtp()} className="font-semibold text-brand-400 hover:text-brand-300">
                        Resend Code
                      </button>
                    ) : (
                      <span>Resend code in {countdown}s</span>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 3: Tell Us Your Name (Merged Signup Step) */}
              {otpStep === 'ENTER_NAME' && (
                <form onSubmit={handleSaveName} className="space-y-4">
                  <div>
                    <label htmlFor="full-name" className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                      Full Name
                    </label>
                    <input
                      id="full-name"
                      type="text"
                      required
                      autoFocus
                      placeholder="Aditya Singh"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-brand-500"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 hover:bg-brand-500 transition"
                  >
                    Complete Profile & Continue →
                  </button>
                </form>
              )}
            </>
          )}

          {/* SECONDARY PATH: Email & Password for Recruiters */}
          {authMode === 'EMAIL_PASSWORD' && (
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div>
                <label htmlFor="recruiter-email" className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Recruiter Email
                </label>
                <input
                  id="recruiter-email"
                  type="email"
                  required
                  autoFocus
                  placeholder="recruiter@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label htmlFor="recruiter-password" className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Password
                  </label>
                  <Link href="/forgot-password" className="text-xs text-brand-400 hover:text-brand-300">
                    Forgot?
                  </Link>
                </div>
                <input
                  id="recruiter-password"
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-brand-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 hover:bg-brand-500 disabled:opacity-50 transition"
              >
                {loading ? 'Signing in…' : 'Sign In as Recruiter'}
              </button>
            </form>
          )}

          {/* Toggle between Candidate Phone OTP & Recruiter Email Login */}
          <div className="pt-4 border-t border-slate-800/80 text-center">
            {authMode === 'PHONE_OTP' ? (
              <button
                type="button"
                onClick={() => {
                  setAuthMode('EMAIL_PASSWORD');
                  setError('');
                }}
                className="text-xs text-slate-400 hover:text-white transition"
              >
                Are you a recruiter? <span className="font-semibold text-brand-400">Log in with Email & Password →</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAuthMode('PHONE_OTP');
                  setOtpStep('ENTER_PHONE');
                  setError('');
                }}
                className="text-xs text-slate-400 hover:text-white transition"
              >
                Candidate? <span className="font-semibold text-brand-400">Log in with Phone OTP →</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">Loading…</div>}>
      <LoginContent />
    </Suspense>
  );
}
