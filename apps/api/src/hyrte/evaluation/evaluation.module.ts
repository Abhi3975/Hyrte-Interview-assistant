import { Module } from '@nestjs/common';
import { ReportIntelligenceService } from './report-intelligence.service';
import { DigModule } from '../dig/dig.module';

/** §7 Phase 7 — exported so HyrteInterviewService can inject ReportIntelligenceService. */
@Module({
  imports: [DigModule], // needs DecisionGraphService + JobSuccessModelService
  providers: [ReportIntelligenceService],
  exports: [ReportIntelligenceService],
})
export class EvaluationModule {}
