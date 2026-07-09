import { Module } from '@nestjs/common';
import { CodingService } from './coding.service';
import { CodingController } from './coding.controller';
import { ExecutionClient } from './execution.client';

@Module({
  controllers: [CodingController],
  providers: [CodingService, ExecutionClient],
  exports: [CodingService],
})
export class CodingModule {}
