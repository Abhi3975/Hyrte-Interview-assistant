import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { SMS_PROVIDER } from './sms/sms-provider.interface';
import { TwilioSmsProvider } from './sms/twilio-sms.provider';

@Module({
  imports: [JwtModule.register({ global: true })],
  controllers: [AuthController],
  // P1 — SMS_PROVIDER is a DI token, not a concrete class: swapping Twilio
  // for MSG91 (or any other vendor) later is a one-line change here, nothing
  // else in the module (OtpService, AuthController) needs to know.
  providers: [AuthService, OtpService, TwilioSmsProvider, { provide: SMS_PROVIDER, useExisting: TwilioSmsProvider }],
  exports: [AuthService],
})
export class AuthModule {}
