'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HyrteMeetingMessage } from '@/lib/hyrte-types';

/**
 * The meeting discussion, with somewhere to scroll and a way to know you
 * missed something.
 *
 * Founder-reported, 30 Sep: "When meetings start, auto-scroll to the bottom,
 * or show an arrow with a notification on it so the user knows messages have
 * dropped into the meeting."
 *
 * The list had no scroll handling whatsoever — it was a fixed-height
 * overflow box that stayed wherever it was. People talk in a live meeting and
 * their messages landed below the fold with nothing to indicate it, so the
 * room looked dead while it was in fact busy.
 *
 * Two behaviours, and the second is why this is not a one-line
 * `scrollIntoView`:
 *
 *  - If you are already at the bottom, new messages follow you down. That is
 *    what you want while watching a conversation.
 *  - If you have scrolled UP — to re-read something someone said — you are not
 *    yanked away from it. Instead a button appears saying how many messages
 *    arrived while you were reading. Auto-scrolling someone who is deliberately
 *    reading history is the more annoying of the two failure modes.
 */

/** Treat "within this many px of the bottom" as being at the bottom — exact equality never holds with sub-pixel layout. */
const AT_BOTTOM_SLACK_PX = 48;

export function MeetingTranscript({ messages }: { messages: HyrteMeetingMessage[] }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const lastCountRef = useRef(messages.length);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const box = boxRef.current;
    if (!box) return;
    box.scrollTo({ top: box.scrollHeight, behavior });
    setUnseen(0);
  };

  // Land at the bottom on first paint rather than animating up from the top —
  // joining a meeting already in progress should show the latest exchange.
  useLayoutEffect(() => {
    scrollToBottom('auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const added = messages.length - lastCountRef.current;
    lastCountRef.current = messages.length;
    if (added <= 0) return;
    if (atBottom) scrollToBottom();
    else setUnseen((n) => n + added);
  }, [messages.length, atBottom]);

  const onScroll = () => {
    const box = boxRef.current;
    if (!box) return;
    const bottom = box.scrollHeight - box.scrollTop - box.clientHeight <= AT_BOTTOM_SLACK_PX;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
  };

  return (
    <div className="relative">
      <div
        ref={boxRef}
        onScroll={onScroll}
        className="mb-3 max-h-80 space-y-2 overflow-y-auto rounded-lg border border-black/5 p-3 dark:border-white/10"
      >
        {messages.map((m) => (
          <div key={m.id} className="text-sm">
            <span className="font-medium">{m.fromStakeholder?.name ?? 'You'}</span>{' '}
            <span className="text-xs text-black/40 dark:text-white/40">
              {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <p className="text-black/80 dark:text-white/80">{m.body}</p>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="text-sm text-black/50 dark:text-white/50">The discussion is just getting started…</p>
        )}
      </div>

      {unseen > 0 && (
        <button
          onClick={() => scrollToBottom()}
          className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg transition hover:bg-brand-700"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M12 5v14M19 12l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {unseen} new {unseen === 1 ? 'message' : 'messages'}
        </button>
      )}
    </div>
  );
}
