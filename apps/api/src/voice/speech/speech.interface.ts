/**
 * Speech provider contracts.
 *
 * The realtime layer (WebSocket gateway) streams audio to an STT provider and
 * streams the interviewer's text to a TTS provider. Concrete adapters
 * (Deepgram/AssemblyAI/OpenAI Realtime for STT; ElevenLabs/Cartesia/OpenAI for
 * TTS) implement these — kept behind interfaces so vendors are swappable and
 * the orchestration logic stays vendor-agnostic. See docs/VOICE_INTERVIEW.md.
 */

export type SpeechLanguage = 'en' | 'hi' | 'hinglish' | 'mr' | 'ta' | 'te';

export interface TranscriptChunk {
  text: string;
  isFinal: boolean;
  confidence: number;
  startMs: number;
  endMs: number;
}

export interface STTProvider {
  readonly name: string;
  isAvailable(): boolean;
  /** Open a streaming session; returns a handle to push PCM/Opus frames. */
  createStream(opts: {
    language: SpeechLanguage;
    onTranscript: (chunk: TranscriptChunk) => void;
  }): Promise<STTStream>;
}

export interface STTStream {
  pushAudio(frame: Buffer): void;
  close(): Promise<void>;
}

/** Dynamic prosody — see practice.service.ts's InterviewerMood; kept as a plain string union here to avoid a cross-module import for one type. */
export type TTSMood = 'neutral' | 'warm' | 'curious' | 'firm';

export interface TTSProvider {
  readonly name: string;
  isAvailable(): boolean;
  /** Synthesize text to an audio stream (chunked for low-latency playback). */
  synthesize(text: string, opts: { language: SpeechLanguage; voiceId?: string; mood?: TTSMood }): AsyncIterable<Buffer>;
}
