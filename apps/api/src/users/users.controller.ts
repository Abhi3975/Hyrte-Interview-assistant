import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

class UpdateProfileDto {
  @IsOptional() @IsString() headline?: string;
  @IsOptional() @IsString() resumeUrl?: string;
  @IsOptional() @IsString() resumeText?: string;
  @IsOptional() @IsArray() skills?: string[];
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() linkedinSummary?: string;
  @IsOptional() @IsString() githubUsername?: string;
}

/** The phone-OTP login's "Tell us your name" step for a brand-new number. */
class UpdateNameDto {
  @IsString() @IsNotEmpty() @MaxLength(120) fullName!: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(RolesGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        organizationId: true,
        candidateProfile: true,
      },
    });
  }

  /** Upsert the candidate profile (resume, skills). */
  @Patch('me/profile')
  async updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.prisma.candidateProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...dto },
      update: dto,
    });
  }

  /** Rename the signed-in user — otpLogin creates phone-only accounts as "Candidate". */
  @Patch('me')
  async updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateNameDto) {
    return this.prisma.user.update({
      where: { id: user.id },
      data: { fullName: dto.fullName.trim() },
      select: { id: true, email: true, fullName: true, role: true, organizationId: true },
    });
  }
}
