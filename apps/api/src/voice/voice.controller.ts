import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FollowUpEngine, NextTurn } from './follow-up-engine.service';
import { IntroDto, NextTurnDto } from './dto/voice.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

/**
 * Turn-based orchestration endpoints for the voice interviewer.
 *
 * The realtime WebSocket gateway (docs/VOICE_INTERVIEW.md) handles audio
 * streaming (STT in, TTS out); it calls this engine to decide each spoken
 * turn. Exposed over REST too so the flow is testable without audio.
 */
@ApiTags('voice')
@ApiBearerAuth()
@Controller('voice')
@UseGuards(RolesGuard)
export class VoiceController {
  constructor(private readonly engine: FollowUpEngine) {}

  @Post('intro')
  @Roles('CANDIDATE')
  async intro(@Body() dto: IntroDto): Promise<{ text: string }> {
    const text = await this.engine.introduction({
      jobRole: dto.jobRole,
      category: dto.category,
      language: dto.language ?? 'English',
    });
    return { text };
  }

  @Post('turn')
  @Roles('CANDIDATE')
  async turn(@Body() dto: NextTurnDto): Promise<NextTurn> {
    const transcript = [...dto.transcript];
    // Fold a live proctoring nudge into the conversation so the interviewer
    // can address it verbally (e.g. "Please remove the phone from view").
    if (dto.proctoringNotice) {
      transcript.push({ role: 'interviewer', content: `[proctoring] ${dto.proctoringNotice}` });
    }
    return this.engine.nextTurn(
      {
        jobRole: dto.jobRole,
        category: dto.category,
        language: dto.language ?? 'English',
        resumeSummary: dto.resumeSummary,
        skills: dto.skills,
        projects: dto.projects,
      },
      transcript,
      dto.currentDifficulty,
    );
  }
}
