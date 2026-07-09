import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FollowUpEngine } from './follow-up-engine.service';
import { VoiceController } from './voice.controller';
import { VoiceGateway } from './voice.gateway';

@Module({
  imports: [JwtModule.register({})],
  controllers: [VoiceController],
  providers: [FollowUpEngine, VoiceGateway],
  exports: [FollowUpEngine],
})
export class VoiceModule {}
