import { Module } from '@nestjs/common';
import { HiringOutcomeService } from './hiring-outcome.service';
import { LearningController } from './learning.controller';

/** §9 Learning Engine — schema-only phase; this module is deliberately just create + list. */
@Module({
  controllers: [LearningController],
  providers: [HiringOutcomeService],
})
export class LearningModule {}
