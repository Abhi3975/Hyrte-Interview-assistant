import { TTSProvider, SpeechLanguage } from './speech.interface';

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
    opts: { language: SpeechLanguage; voiceId?: string },
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
          // Lower stability + non-zero style is the standard ElevenLabs lever
          // for natural, expressive speech — stability:0.5/no style (the old
          // config) trends flat/robotic. speaker_boost adds presence/clarity.
          voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true },
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
