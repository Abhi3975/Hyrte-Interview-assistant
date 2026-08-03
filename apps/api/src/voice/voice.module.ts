import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FollowUpEngine } from './follow-up-engine.service';
import { VoiceController } from './voice.controller';
import { VoiceGateway } from './voice.gateway';
import { TtsController } from './tts.controller';

@Module({
  imports: [JwtModule.register({})],
  controllers: [VoiceController, TtsController],
  providers: [FollowUpEngine, VoiceGateway],
  exports: [FollowUpEngine],
})
export class VoiceModule {}
