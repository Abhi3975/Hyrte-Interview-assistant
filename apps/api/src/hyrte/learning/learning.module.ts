import { Module } from '@nestjs/common';
import { HiringOutcomeService } from './hiring-outcome.service';
import { CalibrationService } from './calibration.service';
import { LearningController } from './learning.controller';
import { CalibrationController } from './calibration.controller';

/**
 * §9 Learning Engine. No longer schema-only: HiringOutcomeService is still the
 * write path, and CalibrationService is the read path that closes the
 * "Decision Graph -> Hiring Outcome -> Model Improvement" loop by turning
 * recorded outcomes into council vote weights.
 */
@Module({
  controllers: [LearningController, CalibrationController],
  providers: [HiringOutcomeService, CalibrationService],
  exports: [CalibrationService],
})
export class LearningModule {}
