import { Global, Module } from '@nestjs/common';
import { LiveCortexService } from './live-cortex.service';

/**
 * Live committee steering, shared by HYRTE's reflection interview and Ally's
 * direct interview room — the same shape as council-shared, which both of
 * their post-interview councils already sit on.
 */
@Global()
@Module({
  providers: [LiveCortexService],
  exports: [LiveCortexService],
})
export class InterviewIntelligenceModule {}
