import { Module } from '@nestjs/common';
import { ProctoringService } from './proctoring.service';
import { ProctoringController } from './proctoring.controller';
import { RiskEngine } from './risk-engine.service';
import { RecordingModule } from '../recording/recording.module';

@Module({
  imports: [RecordingModule],
  controllers: [ProctoringController],
  providers: [ProctoringService, RiskEngine],
  exports: [ProctoringService, RiskEngine],
})
export class ProctoringModule {}
