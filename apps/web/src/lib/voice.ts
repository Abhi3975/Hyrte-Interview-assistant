'use client';

/**
 * Browser voice-interview client.
 *
 * Connects to the API's `/ws/voice` gateway and runs a full spoken loop:
 *   - STT: the Web Speech API transcribes the candidate in-browser and sends
 *     the final text to the gateway (a zero-key path that works everywhere;
 *     production can instead stream mic audio to Deepgram via the gateway).
 *   - LLM: the gateway's follow-up engine returns the interviewer's next turn.
 *   - TTS: SpeechSynthesis speaks the interviewer text (production swaps in
 *     ElevenLabs audio streamed over the socket).
 *
 * The class is transport-only; the page owns UI state via the callbacks.
 */

// Minimal typings for the (still non-standard) Web Speech API.
type SpeechRecognition = any;
declare global {
  interface Window {
    SpeechRecognition?: { new (): SpeechRecognition };
    webkitSpeechRecognition?: { new (): SpeechRecognition };
  }
}

export interface VoiceStartParams {
  jobRole: string;
  category: string;
  language?: string;
  resumeSummary?: string;
  skills?: string[];
}

export interface VoiceCallbacks {
  onInterviewer?: (text: string, meta: { action?: string; nextDifficulty?: string }) => void;
  onPartial?: (text: string) => void;
  onStateChange?: (state: 'connecting' | 'ready' | 'listening' | 'speaking' | 'ended' | 'error') => void;
  onError?: (message: string) => void;
}

const WS_BASE = process.env.NEXT_PUBLIC_API_WS ?? 'ws://localhost:4000';

export class VoiceClient {
  private ws?: WebSocket;
  private recognition?: SpeechRecognition;
  private speaking = false;

  constructor(
    private readonly accessToken: string,
    private readonly cb: VoiceCallbacks,
  ) {}

  connect(params: VoiceStartParams): void {
    this.cb.onStateChange?.('connecting');
    this.ws = new WebSocket(`${WS_BASE}/ws/voice?token=${encodeURIComponent(this.accessToken)}`);

    this.ws.onopen = () => {
      this.ws!.send(JSON.stringify({ type: 'start', ...params }));
    };

    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'interviewer') {
        this.cb.onInterviewer?.(msg.text, { action: msg.action, nextDifficulty: msg.nextDifficulty });
        this.speak(msg.text);
      } else if (msg.type === 'end') {
        this.cb.onStateChange?.('ended');
        this.stop();
      } else if (msg.type === 'error') {
        this.cb.onError?.(msg.message);
        this.cb.onStateChange?.('error');
      }
    };

    this.ws.onerror = () => {
      this.cb.onError?.('Voice connection failed');
      this.cb.onStateChange?.('error');
    };
  }

  /** Speak interviewer text, then start listening for the candidate's reply. */
  private speak(text: string): void {
    this.cb.onStateChange?.('speaking');
    this.speaking = true;
    const utter = new SpeechSynthesisUtterance(text);
    utter.onend = () => {
      this.speaking = false;
      this.listen();
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }

  /** Capture one candidate turn via Web Speech; send the final transcript. */
  private listen(): void {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      this.cb.onError?.('Speech recognition not supported in this browser');
      return;
    }
    this.cb.onStateChange?.('listening');
    const rec: SpeechRecognition = new Ctor();
    this.recognition = rec;
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';

    let finalText = '';
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.cb.onPartial?.(finalText + interim);
    };
    rec.onend = () => {
      if (finalText.trim() && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'candidate_final', text: finalText.trim() }));
      }
    };
    rec.start();
  }

  /** Manually end the current listening turn (e.g. a "done speaking" button). */
  finishTurn(): void {
    this.recognition?.stop();
  }

  stop(): void {
    this.recognition?.stop?.();
    window.speechSynthesis?.cancel();
    this.ws?.close();
  }
}
