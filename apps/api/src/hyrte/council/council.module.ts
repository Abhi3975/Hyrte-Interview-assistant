import { Module } from '@nestjs/common';
import { DecisionCouncilService } from './decision-council.service';
import { DecisionCortexService } from './decision-cortex.service';
import { CouncilController } from './council.controller';
import { DigModule } from '../dig/dig.module'; // AuditLogService, §8

/** §6 Decision Council — exported so HyrteInterviewService can inject DecisionCouncilService. */
@Module({
  imports: [DigModule],
  controllers: [CouncilController],
  providers: [DecisionCouncilService, DecisionCortexService],
  exports: [DecisionCouncilService, DecisionCortexService],
})
export class CouncilModule {}
