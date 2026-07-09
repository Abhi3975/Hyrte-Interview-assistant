import WebSocket from 'ws';
import {
  STTProvider,
  STTStream,
  SpeechLanguage,
  TranscriptChunk,
} from './speech.interface';

/** Map our language codes to Deepgram's. */
const LANG: Record<SpeechLanguage, string> = {
  en: 'en',
  hi: 'hi',
  hinglish: 'hi', // Deepgram handles code-switching under hi/en models
  mr: 'mr',
  ta: 'ta',
  te: 'te',
};

/**
 * Deepgram streaming STT adapter.
 *
 * Opens a realtime WebSocket to Deepgram, forwards PCM/Opus frames from the
 * candidate's mic, and emits interim + final transcript chunks. The voice
 * gateway pushes audio into the returned stream and consumes transcripts via
 * the `onTranscript` callback.
 */
export class DeepgramSTT implements STTProvider {
  readonly name = 'deepgram';

  constructor(private readonly apiKey = process.env.DEEPGRAM_API_KEY) {}

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async createStream(opts: {
    language: SpeechLanguage;
    onTranscript: (chunk: TranscriptChunk) => void;
  }): Promise<STTStream> {
    if (!this.apiKey) throw new Error('Deepgram not configured');

    const params = new URLSearchParams({
      model: 'nova-2',
      language: LANG[opts.language],
      interim_results: 'true',
      punctuate: 'true',
      encoding: 'linear16',
      sample_rate: '16000',
    });
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { authorization: `Token ${this.apiKey}` },
    });

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    ws.on('message', (raw: Buffer) => {
      try {
        const data = JSON.parse(raw.toString());
        const alt = data.channel?.alternatives?.[0];
        if (alt?.transcript) {
          opts.onTranscript({
            text: alt.transcript,
            isFinal: Boolean(data.is_final),
            confidence: alt.confidence ?? 0,
            startMs: Math.round((data.start ?? 0) * 1000),
            endMs: Math.round(((data.start ?? 0) + (data.duration ?? 0)) * 1000),
          });
        }
      } catch {
        // ignore keepalive/metadata frames
      }
    });

    return {
      pushAudio: (frame: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      },
      close: async () => {
        // Deepgram closes gracefully on an empty binary frame.
        if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.alloc(0));
        ws.close();
      },
    };
  }
}
