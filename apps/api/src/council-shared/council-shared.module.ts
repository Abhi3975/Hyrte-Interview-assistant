import { Module } from '@nestjs/common';
import { CouncilCoreService } from './council-core.service';
import { CandidateCouncilController } from './candidate-council.controller';

/** Shared 9-agent orchestration used by both HYRTE's and Ally's Decision Councils — see council-core.service.ts. */
@Module({
  controllers: [CandidateCouncilController],
  providers: [CouncilCoreService],
  exports: [CouncilCoreService],
})
export class CouncilSharedModule {}
