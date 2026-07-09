import { Module } from '@nestjs/common';
import { QuestionService } from './question.service';
import { QuestionController } from './question.controller';
import { AggregatorService } from './aggregator/aggregator.service';

@Module({
  controllers: [QuestionController],
  providers: [QuestionService, AggregatorService],
  exports: [QuestionService, AggregatorService],
})
export class QuestionsModule {}
