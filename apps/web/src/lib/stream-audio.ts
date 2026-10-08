'use client';

/**
 * Progressive playback for the `/voice/speak` MP3 stream.
 *
 * The API already streams ElevenLabs audio chunk by chunk, but both interview
 * rooms used to `await res.blob()` — waiting for the WHOLE clip before Ally
 * made a sound, which threw the streaming away and was most of her lag on
 * longer replies. This feeds chunks into a MediaSource as they arrive, so
 * playback starts on the first chunk.
 *
 * Browsers without MSE support for `audio/mpeg` (Safari/iOS) fall back to the
 * old whole-blob path — slower, but identical behaviour.
 *
 * Resolves to null when `stillCurrent()` went false while waiting (a newer
 * speak() superseded this one). Rejects when the stream yields no audio at
 * all, so callers drop to their browser-TTS fallback instead of hanging in
 * 'speaking' forever on an element that will never fire `ended`.
 */
export async function streamAudio(
  res: Response,
  stillCurrent: () => boolean,
): Promise<{ audio: HTMLAudioElement; release: () => void } | null> {
  const MS = typeof window !== 'undefined' ? window.MediaSource : undefined;
  if (!res.body || !MS || !MS.isTypeSupported('audio/mpeg')) {
    const blob = await res.blob();
    if (!stillCurrent()) return null;
    if (!blob.size) throw new Error('empty audio');
    const url = URL.createObjectURL(blob);
    return { audio: new Audio(url), release: () => URL.revokeObjectURL(url) };
  }

  const reader = res.body.getReader();
  // Hold the first chunk before wiring anything up — an empty or instantly
  // failing stream should fail here, not as a silent element later.
  const first = await reader.read();
  if (!stillCurrent()) { void reader.cancel().catch(() => {}); return null; }
  if (first.done || !first.value?.byteLength) throw new Error('empty audio');

  const ms = new MS();
  const url = URL.createObjectURL(ms);
  const audio = new Audio();
  audio.preload = 'auto';
  const opened = new Promise<void>((resolve) => ms.addEventListener('sourceopen', () => resolve(), { once: true }));
  audio.src = url;
  await opened;
  const sb = ms.addSourceBuffer('audio/mpeg');
  const updated = () => new Promise<void>((resolve) => sb.addEventListener('updateend', () => resolve(), { once: true }));

  const finish = () => {
    try { if (ms.readyState === 'open' && !sb.updating) ms.endOfStream(); } catch {}
  };
  const pump = async (chunk: Uint8Array) => {
    try {
      for (let next: Uint8Array | undefined = chunk; next; ) {
        if (!stillCurrent()) { void reader.cancel().catch(() => {}); return; }
        if (sb.updating) await updated();
        sb.appendBuffer(next as BufferSource);
        await updated();
        const r = await reader.read();
        next = r.done ? undefined : r.value;
      }
    } catch {
      // Network drop mid-reply: play what arrived rather than cutting her off.
    }
    finish();
  };
  void pump(first.value);

  return { audio, release: () => URL.revokeObjectURL(url) };
}

/** `?debugLatency=1` — logs Ally's per-turn timings to the console. */
export function latencyDebugEnabled(): boolean {
  try { return new URLSearchParams(window.location.search).has('debugLatency'); } catch { return false; }
}
