import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Role } from '@prisma/client';

/** E.164: leading +, country code, 6-14 more digits — same shape sendSms already documents. */
const E164 = /^\+[1-9]\d{6,14}$/;

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  fullName!: string;

  // Only CANDIDATE / RECRUITER may self-register; admin roles are granted internally.
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  organizationName?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

// P1 §2 — phone is now the primary identifier (E.164, e.g. +919905270822);
// email is the fallback delivery channel, optional. At-least-one-of(phone,
// email) is enforced in the controller (class-validator has no clean
// built-in for that), not here.
export class RequestOtpDto {
  @IsString()
  fullName!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @ValidateIf((o) => !!o.phone)
  @Matches(E164, { message: 'phone must be E.164 format, e.g. +919905270822' })
  phone?: string;
}

export class VerifyOtpDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @ValidateIf((o) => !!o.phone)
  @Matches(E164, { message: 'phone must be E.164 format, e.g. +919905270822' })
  phone?: string;

  @IsString()
  @MinLength(4)
  code!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(4)
  code!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
