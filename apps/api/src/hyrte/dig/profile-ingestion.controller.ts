import { Body, Controller, Get, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileIngestionService } from './profile-ingestion.service';
import { EvidenceGraphService } from './evidence-graph.service';
import { CandidateIntelligenceCardService } from './candidate-intelligence-card.service';
import { JobSuccessModelService } from './job-success-model.service';
import { IngestResumeDto, IngestLinkedInDto, IngestGitHubDto, IngestJobDescriptionDto } from '../dto/hyrte.dto';

/**
 * §0/§3.1 — candidate-level intake into the Shared Candidate Brain (Evidence
 * Graph), the architecture diagram's left half. Not scoped under
 * `hyrte/sessions/:id` like the rest of `dig/` — this evidence belongs to the
 * candidate, not any one session, and should be available to every future
 * HYRTE session they start.
 */
@ApiTags('hyrte-profile-ingestion')
@ApiBearerAuth()
@Controller('profile/ingest')
@UseGuards(RolesGuard)
@Roles('CANDIDATE')
export class ProfileIngestionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: ProfileIngestionService,
    private readonly evidence: EvidenceGraphService,
    private readonly intelligenceCard: CandidateIntelligenceCardService,
    private readonly jobSuccessModel: JobSuccessModelService,
  ) {}

  /** Every candidate-level evidence object (resume/LinkedIn/GitHub) ingested so far, plus the resulting Intelligence Card. */
  @Get()
  async get(@CurrentUser() user: AuthenticatedUser) {
    const [profile, card] = await Promise.all([
      this.evidence.getForCandidate(user.id),
      this.intelligenceCard.get(user.id),
    ]);
    return { evidence: profile, intelligenceCard: card };
  }

  @Post('resume')
  async resume(@CurrentUser() user: AuthenticatedUser, @Body() dto: IngestResumeDto) {
    await this.prisma.candidateProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, resumeText: dto.resumeText },
      update: { resumeText: dto.resumeText },
    });
    return this.ingestion.ingestResume(user.id, dto.resumeText);
  }

  @Post('linkedin')
  async linkedin(@CurrentUser() user: AuthenticatedUser, @Body() dto: IngestLinkedInDto) {
    await this.prisma.candidateProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, linkedinSummary: dto.linkedinSummary },
      update: { linkedinSummary: dto.linkedinSummary },
    });
    return this.ingestion.ingestLinkedIn(user.id, dto.linkedinSummary);
  }

  @Post('github')
  async github(@CurrentUser() user: AuthenticatedUser, @Body() dto: IngestGitHubDto) {
    await this.prisma.candidateProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, githubUsername: dto.username },
      update: { githubUsername: dto.username },
    });
    return this.ingestion.ingestGitHub(user.id, dto.username);
  }

  /**
   * §0/§3.3 — the diagram's other intake box: "Job description +
   * company/industry context". Decomposes real, pasted JD text into a Job
   * Success Model instead of the synthetic 6-generator-input stand-in.
   * `sessionId` is optional: pass it to replace that session's Job Success
   * Model with the real-JD-derived one (what the Prediction Engine/Decision
   * Cortex already read); omit it to create a standalone model not tied to
   * any one session.
   */
  @Post('job-description')
  async jobDescription(@CurrentUser() user: AuthenticatedUser, @Body() dto: IngestJobDescriptionDto) {
    if (dto.sessionId) {
      const session = await this.prisma.hyrteSession.findFirst({ where: { id: dto.sessionId, candidateId: user.id } });
      if (!session) throw new NotFoundException('Session not found');
    }
    return this.jobSuccessModel.generateFromText(dto.jobDescriptionText, dto.companyContext, dto.sessionId);
  }
}
