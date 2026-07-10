'use client';

import { api } from './api';

/**
 * Browser-side proctoring SDK.
 *
 * Watches cheap, high-signal DOM/browser events (tab switches, focus loss,
 * fullscreen exit, copy/paste, devtools) and coarse webcam-based face presence,
 * then reports them to the backend risk engine. It deliberately does the
 * lightweight detection in-browser and leaves heavy vision/audio inference to
 * the server-side services — the client only forwards evidence.
 *
 * High-frequency signals are sampled and batched to avoid flooding the API;
 * the server applies weighting + decay so transient blips don't matter.
 */

export type ProctorType =
  | 'TAB_SWITCH'
  | 'WINDOW_BLUR'
  | 'FOCUS_LOSS'
  | 'FULLSCREEN_EXIT'
  | 'COPY_PASTE'
  | 'CLIPBOARD_USAGE'
  | 'SCREEN_CAPTURE_ATTEMPT'
  | 'FACE_NOT_DETECTED'
  | 'MULTIPLE_FACES';

export interface ProctorConfig {
  sessionId: string;
  onEvent?: (type: ProctorType) => void;
  // How often to sample the webcam for face presence (ms).
  faceSampleMs?: number;
}

interface QueuedEvent {
  type: ProctorType;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH';
  payload?: Record<string, unknown>;
}

export class ProctorClient {
  private queue: QueuedEvent[] = [];
  private flushTimer?: ReturnType<typeof setInterval>;
  private faceTimer?: ReturnType<typeof setInterval>;
  private videoEl?: HTMLVideoElement;
  private detector?: any; // FaceDetector (Shape Detection API) when available
  private disposed = false;
  private readonly handlers: Array<[string, EventListener]> = [];

  constructor(private readonly cfg: ProctorConfig) {}

  /** Begin monitoring. `videoEl` is the candidate's live webcam element. */
  start(videoEl?: HTMLVideoElement): void {
    this.videoEl = videoEl;

    this.on(document, 'visibilitychange', () => {
      if (document.hidden) this.record('TAB_SWITCH', 'MEDIUM');
    });
    this.on(window, 'blur', () => this.record('WINDOW_BLUR', 'LOW'));
    this.on(document, 'fullscreenchange', () => {
      if (!document.fullscreenElement) this.record('FULLSCREEN_EXIT', 'MEDIUM');
    });
    this.on(document, 'copy', () => this.record('COPY_PASTE', 'LOW', { action: 'copy' }));
    this.on(document, 'paste', () => this.record('COPY_PASTE', 'MEDIUM', { action: 'paste' }));
    // Heuristic devtools/screenshot key combos.
    this.on(document, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (ev.key === 'PrintScreen') this.record('SCREEN_CAPTURE_ATTEMPT', 'MEDIUM');
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ['i', 'j', 'c'].includes(ev.key.toLowerCase())) {
        this.record('SCREEN_CAPTURE_ATTEMPT', 'LOW', { hint: 'devtools' });
      }
    });

    // Batch flush every 3s.
    this.flushTimer = setInterval(() => void this.flush(), 3000);

    // Coarse face presence via the Shape Detection API where supported.
    if (this.videoEl && 'FaceDetector' in window) {
      // @ts-expect-error experimental API
      this.detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
      this.faceTimer = setInterval(() => void this.sampleFace(), this.cfg.faceSampleMs ?? 4000);
    }
  }

  private async sampleFace(): Promise<void> {
    if (!this.videoEl || !this.detector || this.videoEl.readyState < 2) return;
    try {
      const faces = await this.detector.detect(this.videoEl);
      if (faces.length === 0) this.record('FACE_NOT_DETECTED', 'LOW');
      else if (faces.length > 1) this.record('MULTIPLE_FACES', 'HIGH', { count: faces.length });
    } catch {
      // detection unsupported on this frame — ignore
    }
  }

  private record(type: ProctorType, severity: QueuedEvent['severity'] = 'LOW', payload?: Record<string, unknown>): void {
    if (this.disposed) return;
    this.queue.push({ type, severity, payload });
    this.cfg.onEvent?.(type);
    // Escalate high-severity signals immediately rather than waiting for batch.
    if (severity === 'HIGH') void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const events = this.queue.splice(0, this.queue.length).map((e) => ({
      sessionId: this.cfg.sessionId,
      type: e.type,
      severity: e.severity,
      payload: e.payload,
    }));
    try {
      await api.post('/proctoring/events/batch', { events });
    } catch {
      // Re-queue on failure so we don't silently drop evidence.
      this.queue.unshift(...events.map((e) => ({ type: e.type as ProctorType, severity: e.severity, payload: e.payload })));
    }
  }

  private on(target: EventTarget, name: string, handler: EventListener): void {
    target.addEventListener(name, handler);
    this.handlers.push([name, handler]);
  }

  dispose(): void {
    this.disposed = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.faceTimer) clearInterval(this.faceTimer);
    void this.flush();
    // Best-effort listener cleanup.
    for (const [name, handler] of this.handlers) {
      document.removeEventListener(name, handler);
      window.removeEventListener(name, handler);
    }
  }
}
