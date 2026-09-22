import { Module } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';
import { EvaluationController } from './evaluation.controller';
import { ProctoringModule } from '../proctoring/proctoring.module'; // RiskEngine — the multi-modal signal source

@Module({
  imports: [ProctoringModule],
  controllers: [EvaluationController],
  providers: [EvaluationService],
  exports: [EvaluationService],
})
export class EvaluationModule {}
