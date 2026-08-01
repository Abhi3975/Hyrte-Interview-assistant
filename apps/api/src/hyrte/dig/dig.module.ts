import { Module } from '@nestjs/common';
import { DecisionGraphService } from './decision-graph.service';
import { EvidenceGraphService } from './evidence-graph.service';
import { JobSuccessModelService } from './job-success-model.service';
import { InvestigationPlanService } from './investigation-plan.service';
import { CandidateIntelligenceCardService } from './candidate-intelligence-card.service';
import { AuditLogService } from './audit-log.service';
import { DigController } from './dig.controller';

/**
 * Phase 1 data backbone (build prompt §3): Evidence Graph, Candidate
 * Intelligence Card, Job Success Model, Investigation Plan, and the DIG's
 * write-path contract (Decision Graph). Exported so later phases (Chaos
 * Engine, Task Execution, the reflection interviewer) can inject these
 * services directly instead of writing to the underlying tables themselves.
 * PrismaService is global (`@Global()` PrismaModule) so it doesn't need to be
 * re-provided here.
 */
@Module({
  controllers: [DigController],
  providers: [
    DecisionGraphService,
    EvidenceGraphService,
    JobSuccessModelService,
    InvestigationPlanService,
    CandidateIntelligenceCardService,
    AuditLogService,
  ],
  exports: [
    DecisionGraphService,
    EvidenceGraphService,
    JobSuccessModelService,
    InvestigationPlanService,
    CandidateIntelligenceCardService,
    AuditLogService,
  ],
})
export class DigModule {}
