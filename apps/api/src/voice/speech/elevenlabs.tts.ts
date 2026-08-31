import { TTSProvider, SpeechLanguage, TTSMood } from './speech.interface';

/**
 * Dynamic prosody presets — the standard ElevenLabs levers (stability down /
 * style up = more expressive; stability up / style down = calmer, steadier)
 * mapped onto a few real conversational moments this app's interviewer
 * persona already reasons about (see practice.service.ts's InterviewerMood).
 * Not full emotional voice acting — a real, working tone shift within what
 * one TTS call's settings can actually do.
 */
const MOOD_VOICE_SETTINGS: Record<TTSMood, { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean }> = {
  neutral: { stability: 0.4, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true },
  warm: { stability: 0.55, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true },
  curious: { stability: 0.35, similarity_boost: 0.75, style: 0.5, use_speaker_boost: true },
  firm: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
};

/**
 * ElevenLabs streaming TTS adapter.
 *
 * Streams synthesized audio back in chunks for low-latency playback — the
 * gateway pipes these to the candidate's speaker as they arrive rather than
 * waiting for the full clip. ElevenLabs' multilingual model covers all
 * supported interview languages with a single voice.
 */
export class ElevenLabsTTS implements TTSProvider {
  readonly name = 'elevenlabs';
  // A neutral, professional default voice; recruiters can override per interview.
  private readonly defaultVoice = 'EXAVITQu4vr4xnSDxMaL';

  constructor(private readonly apiKey = process.env.ELEVENLABS_API_KEY) {}

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async *synthesize(
    text: string,
    opts: { language: SpeechLanguage; voiceId?: string; mood?: TTSMood },
  ): AsyncIterable<Buffer> {
    if (!this.apiKey) throw new Error('ElevenLabs not configured');
    const voiceId = opts.voiceId ?? this.defaultVoice;

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': this.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: MOOD_VOICE_SETTINGS[opts.mood ?? 'neutral'],
        }),
      },
    );

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      throw new Error(`ElevenLabs error ${res.status}: ${body.slice(0, 200)}`);
    }

    // Stream the audio chunks as they arrive.
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield Buffer.from(value);
    }
  }
}
