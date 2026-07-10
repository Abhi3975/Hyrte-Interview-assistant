'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Role = 'CANDIDATE' | 'RECRUITER' | 'ORG_ADMIN' | 'SUPER_ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  organizationId: string | null;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (user: AuthUser, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

// Persisted so a refresh keeps the user signed in. Access tokens are short
// lived; the refresh token rotates on every use server-side.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setSession: (user, accessToken, refreshToken) => set({ user, accessToken, refreshToken }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      logout: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    { name: 'interviewai-auth' },
  ),
);
