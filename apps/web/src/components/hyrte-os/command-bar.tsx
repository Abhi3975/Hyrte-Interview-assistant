'use client';

import { useState } from 'react';

export function CommandBar({ onSend }: { onSend?: (text: string) => void }) {
  const [text, setText] = useState('');

  return (
    <div className="hos-card flex items-center gap-2 p-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask Kabir to estimate the analytics feature…"
        className="flex-1 bg-transparent px-2 py-1.5 text-[13px] outline-none placeholder:text-[color:var(--hos-text-dim)]"
      />
      <button
        onClick={() => {
          if (!text.trim()) return;
          onSend?.(text);
          setText('');
        }}
        className="rounded-md px-3 py-1.5 text-[12.5px] font-medium transition"
        style={{ background: 'var(--hos-accent-glow)', color: 'var(--hos-accent)' }}
      >
        Send
      </button>
    </div>
  );
}
