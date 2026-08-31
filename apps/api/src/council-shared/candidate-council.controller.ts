import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

/**
 * Unified recruiter view: one candidate can have run BOTH a HYRTE workplace
 * simulation and a direct Ally interview, each with its own Decision
 * Council. Rather than merging the two underlying data models (different
 * recommendation scales, migration risk — see CouncilCoreService's own
 * comment), this endpoint just fetches the candidate's most recent verdict
 * from each surface side by side, so the recruiter reads one page instead of
 * cross-referencing two.
 */
@ApiTags('council')
@ApiBearerAuth()
@Controller('council/candidate/:candidateId')
@UseGuards(RolesGuard)
@Roles('RECRUITER', 'ORG_ADMIN', 'SUPER_ADMIN')
export class CandidateCouncilController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@Param('candidateId') candidateId: string) {
    const [hyrteReport, evaluation] = await Promise.all([
      this.prisma.hyrteInterviewReport.findFirst({
        where: { session: { candidateId } },
        orderBy: { generatedAt: 'desc' },
      }),
      this.prisma.evaluation.findFirst({
        where: { session: { candidateId } },
        orderBy: { createdAt: 'desc' },
        include: { session: { include: { interview: { select: { jobRole: true } } } } },
      }),
    ]);

    const [hyrte, ally] = await Promise.all([
      hyrteReport
        ? Promise.all([
            this.prisma.hyrteCouncilAgentReport.findMany({ where: { sessionId: hyrteReport.sessionId }, orderBy: { agentKey: 'asc' } }),
            this.prisma.hyrteCouncilDiscussionEntry.findMany({ where: { sessionId: hyrteReport.sessionId }, orderBy: { ordinal: 'asc' } }),
          ]).then(([agentReports, discussion]) => ({ report: hyrteReport, agentReports, discussion }))
        : Promise.resolve(null),
      evaluation
        ? Promise.all([
            this.prisma.interviewCouncilAgentReport.findMany({ where: { sessionId: evaluation.sessionId }, orderBy: { agentKey: 'asc' } }),
            this.prisma.interviewCouncilDiscussionEntry.findMany({ where: { sessionId: evaluation.sessionId }, orderBy: { ordinal: 'asc' } }),
          ]).then(([agentReports, discussion]) => ({ evaluation, agentReports, discussion }))
        : Promise.resolve(null),
    ]);

    return { hyrte, ally };
  }
}
