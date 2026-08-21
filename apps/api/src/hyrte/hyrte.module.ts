import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { HyrteSessionsController } from './hyrte-sessions.controller';
import { HyrteSessionsService } from './hyrte-sessions.service';
import { HyrteWorkplaceController } from './hyrte-workplace.controller';
import { HyrteWorkplaceService } from './hyrte-workplace.service';
import { HyrteGateway } from './hyrte.gateway';
import { HyrteSimulationGeneratorService } from './generator/simulation-generator.service';
import { HyrteStakeholderAgentService } from './agents/stakeholder-agent.service';
import { HyrteConsequenceService } from './consequences/consequence.service';
import { HyrteInterviewController } from './interview/hyrte-interview.controller';
import { HyrteInterviewService } from './interview/hyrte-interview.service';
import { DigModule } from './dig/dig.module';
import { CouncilModule } from './council/council.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { LearningModule } from './learning/learning.module';
import { SimulationRequestController } from './simulation-request.controller';
import { SimulationRequestService } from './simulation-request.service';
import { HyrteWorkTickService } from './work/work-tick.service';
import { HyrteCommandBarService } from './work/command-bar.service';
import { HyrteMeetingService } from './meetings/meeting.service';
import { HyrteRecruiterController } from './recruiter/hyrte-recruiter.controller';
import { HyrteRecruiterService } from './recruiter/hyrte-recruiter.service';

@Module({
  // DigModule exports DecisionGraphService (the DIG write-path contract) for
  // HyrteWorkplaceService, plus the rest of Phase 1's data-backbone services.
  // CouncilModule exports DecisionCouncilService for HyrteInterviewService.
  // EvaluationModule exports ReportIntelligenceService (Phase 7) likewise.
  // LearningModule (Phase 9) is standalone — nothing else injects from it.
  imports: [JwtModule.register({}), DigModule, CouncilModule, EvaluationModule, LearningModule],
  controllers: [
    HyrteSessionsController,
    HyrteWorkplaceController,
    HyrteInterviewController,
    SimulationRequestController,
    HyrteRecruiterController,
  ],
  providers: [
    HyrteSessionsService,
    HyrteWorkplaceService,
    HyrteGateway,
    HyrteSimulationGeneratorService,
    HyrteStakeholderAgentService,
    HyrteConsequenceService,
    HyrteInterviewService,
    SimulationRequestService,
    HyrteWorkTickService,
    HyrteCommandBarService,
    HyrteMeetingService,
    HyrteRecruiterService,
  ],
})
export class HyrteModule {}
