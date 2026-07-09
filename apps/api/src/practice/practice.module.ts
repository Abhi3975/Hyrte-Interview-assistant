import { Module } from '@nestjs/common';
import { PracticeService } from './practice.service';
import { PracticeController } from './practice.controller';
import { PistonClient } from './piston.client';
import { QuestionsModule } from '../questions/questions.module';
import { EvaluationModule } from '../evaluation/evaluation.module';

@Module({
  imports: [QuestionsModule, EvaluationModule],
  controllers: [PracticeController],
  providers: [PracticeService, PistonClient],
})
export class PracticeModule {}
