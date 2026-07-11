import { Body, Controller, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { ForgotPasswordDto, LoginDto, RefreshDto, RegisterDto, RequestOtpDto, ResetPasswordDto, VerifyOtpDto } from './dto/auth.dto';
import { Public } from '../common/decorators/public.decorator';
import { AuditService } from '../common/audit/audit.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: any) {
    const ctx = { ip: req.ip, ua: req.headers['user-agent'] };
    const result = await this.auth.register(dto, ctx);
    await this.audit.record({
      actorId: result.user.id,
      organizationId: result.user.organizationId,
      action: 'auth.register',
      ip: ctx.ip,
      userAgent: ctx.ua,
    });
    return result;
  }

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: any) {
    const ctx = { ip: req.ip, ua: req.headers['user-agent'] };
    const result = await this.auth.login(dto, ctx);
    await this.audit.record({
      actorId: result.user.id,
      organizationId: result.user.organizationId,
      action: 'auth.login',
      ip: ctx.ip,
      userAgent: ctx.ua,
    });
    return result;
  }

  /** Request a one-time code for the "Sign Up to Start" interview lobby. */
  @Public()
  @Post('request-otp')
  async requestOtp(@Body() dto: RequestOtpDto) {
    const code = this.otp.request(dto.fullName, dto.email, dto.phone);
    // Prefer real email (no telecom/DLT restrictions): SendGrid then Resend.
    if (this.otp.emailConfigured()) {
      const ok = (await this.otp.sendViaSendGrid(dto.email, code)) || (await this.otp.sendEmail(dto.email, code));
      if (ok) return { sent: true, channel: 'email' };
    }
    // Then real SMS when a provider is configured and a phone was given.
    if (dto.phone && this.otp.smsConfigured()) {
      const ok = await this.otp.sendSms(dto.phone, code);
      if (ok) return { sent: true, channel: 'sms' };
    }
    // Fallback: demo mode returns the code so the UI can show it.
    const demoMode = process.env.OTP_DEMO_MODE !== 'false';
    return { sent: true, channel: 'demo', ...(demoMode ? { devCode: code } : {}) };
  }

  /** Verify the code and start a passwordless candidate session. */
  @Public()
  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: any) {
    const pending = this.otp.verify(dto.email, dto.code);
    if (!pending) throw new UnauthorizedException('Invalid or expired code');
    const ctx = { ip: req.ip, ua: req.headers['user-agent'] };
    const result = await this.auth.otpLogin(dto.email, pending.fullName, ctx);
    await this.audit.record({
      actorId: result.user.id,
      organizationId: result.user.organizationId,
      action: 'auth.otp_login',
      ip: ctx.ip,
      userAgent: ctx.ua,
    });
    return result;
  }

  /** Send a password-reset code to the account email. */
  @Public()
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const exists = await this.auth.userExists(dto.email);
    // Always respond the same way so we don't reveal which emails are registered.
    if (!exists) return { sent: true };
    const code = this.otp.requestReset(dto.email);
    if (this.otp.emailConfigured()) {
      const ok = (await this.otp.sendViaSendGrid(dto.email, code)) || (await this.otp.sendEmail(dto.email, code));
      if (ok) return { sent: true, channel: 'email' };
    }
    const demoMode = process.env.OTP_DEMO_MODE !== 'false';
    return { sent: true, channel: 'demo', ...(demoMode ? { devCode: code } : {}) };
  }

  /** Verify the reset code and set a new password. */
  @Public()
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    if (!this.otp.verifyReset(dto.email, dto.code)) throw new UnauthorizedException('Invalid or expired code');
    await this.auth.setPasswordByEmail(dto.email, dto.newPassword);
    return { success: true };
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: any) {
    return this.auth.refresh(dto.refreshToken, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
  }

  @Public()
  @Post('logout')
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
    return { success: true };
  }
}
