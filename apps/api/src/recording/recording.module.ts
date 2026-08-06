import { Module } from '@nestjs/common';
import { RecordingService } from './recording.service';

@Module({
  providers: [RecordingService],
  exports: [RecordingService],
})
export class RecordingModule {}
