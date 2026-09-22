'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { HyrteLiveToast, useHyrteStore } from '@/store/hyrte';

const SOURCE_LABEL: Record<HyrteLiveToast['source'], string> = {
  INBOX: 'Inbox',
  SLACK: 'Slack',
  TASK: 'Work',
  MEETING: 'Meeting',
  STATE: 'Company',
};

/** Urgent items stay long enough to actually read and act on; routine ones get out of the way. */
const DISMISS_AFTER_MS = { urgent: 12_000, normal: 7_000 };

function Toast({ toast }: { toast: HyrteLiveToast }) {
  const dismiss = useHyrteStore((s) => s.dismissToast);

  useEffect(() => {
    const timeout = setTimeout(() => dismiss(toast.id), toast.urgent ? DISMISS_AFTER_MS.urgent : DISMISS_AFTER_MS.normal);
    return () => clearTimeout(timeout);
  }, [toast.id, toast.urgent, dismiss]);

  const body = (
    <>
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            toast.urgent ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50'
          }`}
        >
          {SOURCE_LABEL[toast.source]}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{toast.title}</span>
      </div>
      <p className="mt-1 text-xs text-black/60 dark:text-white/60">{toast.body}</p>
    </>
  );

  return (
    <div
      className={`pointer-events-auto w-80 rounded-xl border bg-white p-3 shadow-lg dark:bg-neutral-900 ${
        toast.urgent ? 'border-red-500/40' : 'border-black/10 dark:border-white/10'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{toast.href ? <Link href={toast.href}>{body}</Link> : body}</div>
        <button
          onClick={() => dismiss(toast.id)}
          className="shrink-0 rounded px-1 text-sm text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}

/**
 * Refinements doc §4 — "Here's the thing you need to deal with", not "here's a
 * notification". Renders the live toast queue fed by HyrteSessionProvider, so
 * something arriving in the simulated company is visible immediately from
 * anywhere in the workspace, and clicking it goes straight to the surface it
 * landed on. Mounted once for the whole session subtree.
 */
export function LiveToasts() {
  const toasts = useHyrteStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} />
      ))}
    </div>
  );
}
