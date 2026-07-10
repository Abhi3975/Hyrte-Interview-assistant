import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Category, Difficulty, InterviewMode } from '@prisma/client';

export class CreateInterviewDto {
  @IsString() title!: string;
  @IsString() jobRole!: string;
  @IsEnum(Category) category!: Category;
  @IsOptional() @IsEnum(Difficulty) difficulty?: Difficulty;
  @IsOptional() @IsEnum(InterviewMode) mode?: InterviewMode;
  @IsOptional() @IsInt() @Min(5) durationMins?: number;
  @IsOptional() @IsString() questionSetId?: string;
  @IsOptional() @IsArray() questionIds?: string[];
  @IsOptional() config?: Record<string, unknown>;
}

export class InviteCandidateDto {
  @IsString() candidateId!: string;
}

export class GenerateQuestionsDto {
  @IsInt() @Min(1) count!: number;
}

export class CreateInviteDto {
  @IsString() name!: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsInt() @Min(1) expiryHours?: number;
}

export class SubmitAnswerDto {
  @IsString() interviewQuestionId!: string;
  @IsOptional() @IsString() responseText?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsInt() timeSpentSec?: number;
}

export class StartSessionDto {
  // One-time token issued by the admin/recruiter who unlocked the assessment.
  @IsString() sessionToken!: string;
}

export class VerifyIdentityDto {
  // Reference to the liveness/face-match result from the vision service.
  @IsString() verificationRef!: string;
  @IsOptional() passed?: boolean;
}
