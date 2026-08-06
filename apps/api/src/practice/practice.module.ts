import { Module } from '@nestjs/common';
import { PracticeService } from './practice.service';
import { PracticeController } from './practice.controller';
import { PistonClient } from './piston.client';
import { QuestionsModule } from '../questions/questions.module';
import { EvaluationModule } from '../evaluation/evaluation.module';
import { RecordingModule } from '../recording/recording.module';

@Module({
  imports: [QuestionsModule, EvaluationModule, RecordingModule],
  controllers: [PracticeController],
  providers: [PracticeService, PistonClient],
})
export class PracticeModule {}
