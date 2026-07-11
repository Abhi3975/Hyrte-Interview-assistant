'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Mock Interview now runs through the conversational AI Interview Room
// (Ally + voice + coding + a Mixed / Theory / Coding chooser).
export default function MockInterviewRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/candidate/interview'); }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-black/50 dark:text-white/50">
      Opening your AI mock interview…
    </div>
  );
}
