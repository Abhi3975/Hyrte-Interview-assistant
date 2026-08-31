import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ElevenLabsTTS } from './speech/elevenlabs.tts';
import { TTSMood } from './speech/speech.interface';

class SpeakDto {
  @IsString() @MaxLength(2000) text!: string;
  /** Dynamic prosody — see practice.service.ts's InterviewerMood / elevenlabs.tts.ts's MOOD_VOICE_SETTINGS. */
  @IsOptional() @IsIn(['neutral', 'warm', 'curious', 'firm']) mood?: TTSMood;
}

/**
 * Real neural TTS, actually wired up — `ElevenLabsTTS` (speech/elevenlabs.tts.ts)
 * already existed, tuned for natural delivery, but was never called from
 * anywhere (confirmed by grep — only its own definition file referenced it).
 * The "Ally" room's real production voice is the browser's native
 * `speechSynthesis`, which is fundamentally robotic — no amount of pitch/rate
 * tuning fixes that, it's a different quality tier of synthesis entirely.
 * This is the connection that was missing, not a parameter tweak.
 */
@ApiTags('voice')
@ApiBearerAuth()
@Controller('voice')
@UseGuards(RolesGuard)
export class TtsController {
  private readonly tts = new ElevenLabsTTS();

  @Post('speak')
  @Roles('CANDIDATE')
  async speak(@Body() dto: SpeakDto, @Res() res: Response): Promise<void> {
    if (!this.tts.isAvailable()) {
      res.status(503).json({ error: { message: 'Voice synthesis not configured' } });
      return;
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    try {
      for await (const chunk of this.tts.synthesize(dto.text, { language: 'en', mood: dto.mood })) {
        res.write(chunk);
      }
      res.end();
    } catch (e) {
      if (!res.headersSent) {
        res.status(502).json({ error: { message: e instanceof Error ? e.message : 'TTS failed' } });
      } else {
        res.end();
      }
    }
  }
}
