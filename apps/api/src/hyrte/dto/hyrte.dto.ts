import { IsArray, IsBoolean, IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import {
  Difficulty,
  EvidenceLinkKind,
  EvidenceSource,
  EvidenceType,
  HiringOutcomeEventType,
  HyrteSessionType,
  PerformanceRating,
} from '@prisma/client';

export class CreateHyrteSessionDto {
  @IsString() role!: string;
  @IsString() experienceLevel!: string;
  @IsString() industry!: string;
  @IsString() companyType!: string;
  @IsEnum(Difficulty) difficulty!: Difficulty;
  @IsString() culture!: string;
  @IsOptional() @IsEnum(HyrteSessionType) sessionType?: HyrteSessionType;
}

export class ReplyInboxDto {
  @IsString() body!: string;
}

export class SendSlackMessageDto {
  @IsString() channel!: string;
  @IsString() body!: string;
}

export class UpdateTaskDto {
  @IsOptional() @IsString() status?: string;
}

export class MarkInboxReadDto {
  @IsOptional() @IsBoolean() read?: boolean;
}

export class InterviewTurnDto {
  @IsString() message!: string;
}

export class StartInterviewDto {
  /** §5.9 Boss Level — explicit opt-in only, never defaulted on. */
  @IsOptional() @IsBoolean() bossMode?: boolean;
}

export class AskDecisionCortexDto {
  @IsString() question!: string;
}

export class RecordHiringOutcomeDto {
  @IsEnum(HiringOutcomeEventType) eventType!: HiringOutcomeEventType;
  @IsOptional() @IsEnum(PerformanceRating) performanceRating?: PerformanceRating;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
}

export class CreateEvidenceDto {
  @IsEnum(EvidenceSource) source!: EvidenceSource;
  @IsEnum(EvidenceType) type!: EvidenceType;
  @IsString() rawText!: string;
  @IsOptional() @IsBoolean() needsInvestigation?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) probeCandidates?: string[];
}

export class LinkEvidenceDto {
  @IsString() toId!: string;
  @IsEnum(EvidenceLinkKind) kind!: EvidenceLinkKind;
  @IsOptional() @IsString() note?: string;
}

export class SubmitBaselineChallengeDto {
  @IsString() optionId!: string;
  @IsString() reasoning!: string;
}
